import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { nanoid } from "nanoid";
import { store, readJson, writeJson } from "./lib/blobs";

const OUTREACH_CAMPAIGNS = "agent-hq-outreach-campaigns";
const OUTREACH_EMAILS = "agent-hq-outreach-emails";
const OUTREACH_CLICKS = "agent-hq-outreach-clicks";
const ACTIVITY = "agent-hq-activity";

type ClickPayload = { c: string; l: string; e: string; u: string };

/**
 * Decodes a base64url click token, bumps the associated campaign/email
 * counters, then 302s to the original URL. Fails open — if decoding fails
 * we just redirect to the landing page so users never see a broken link.
 */
export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  const token = (event.path.split("/").pop() ?? "").trim();
  if (!token) return { statusCode: 400, body: "Missing token" };

  // Decode the token. Base64url → JSON → payload.
  let payload: ClickPayload | null = null;
  try {
    const normalised = token.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((token.length + 3) % 4);
    const json = Buffer.from(normalised, "base64").toString("utf8");
    payload = JSON.parse(json) as ClickPayload;
  } catch {
    payload = null;
  }

  if (!payload || !payload.u) {
    return { statusCode: 400, body: "Invalid tracking token" };
  }

  // Narrow to non-null via a const binding so TS sees it everywhere below.
  const p: ClickPayload = payload;
  const destination = p.u;

  // Log the click — one blob per click, keyed for per-campaign listing.
  if (p.c && p.e) {
    const clickId = nanoid(12);
    const clickedAt = new Date().toISOString();
    try {
      await writeJson(store(OUTREACH_CLICKS), `${p.c}/${clickedAt}-${clickId}`, {
        id: clickId,
        campaign_id: p.c,
        lead_id: p.l ?? null,
        email_id: p.e,
        url: destination,
        user_agent: event.headers["user-agent"] ?? null,
        ip: event.headers["x-forwarded-for"] ?? null,
        clicked_at: clickedAt,
      });

      // Bump per-email click counter and flip status to "clicked" if still
      // "sent" or "delivered" (don't regress past "replied").
      const es = store(OUTREACH_EMAILS);
      const { blobs } = await es.list({ prefix: `${p.c}/` });
      for (const b of blobs) {
        const row = await readJson<Record<string, unknown>>(es, b.key);
        if ((row as { id?: string } | null)?.id === p.e) {
          const prevStatus = row?.status as string | undefined;
          const nextStatus = prevStatus === "replied" ? "replied" : "clicked";
          await writeJson(es, b.key, {
            ...row,
            status: nextStatus,
            click_count: ((row?.click_count as number) ?? 0) + 1,
            last_clicked_at: clickedAt,
            updated_at: clickedAt,
          });
          break;
        }
      }

      // Bump campaign counter.
      const cs = store(OUTREACH_CAMPAIGNS);
      const campaign = await readJson<Record<string, unknown>>(cs, p.c);
      if (campaign) {
        await writeJson(cs, p.c, {
          ...campaign,
          emails_clicked: ((campaign.emails_clicked as number) ?? 0) + 1,
          updated_at: clickedAt,
        });
      }

      // Surface in activity.
      const activityId = nanoid(12);
      await writeJson(store(ACTIVITY), `${clickedAt}-${activityId}`, {
        id: activityId,
        agent_id: null,
        category: "email",
        summary: `Link clicked in campaign ${(campaign?.name as string) ?? p.c}`,
        details: { campaign_id: p.c, email_id: p.e, url: destination },
        created_at: clickedAt,
      });
    } catch (err) {
      console.error("[track-click] logging error:", err);
      // Don't block redirect on log failure.
    }
  }

  return {
    statusCode: 302,
    headers: { Location: destination, "Cache-Control": "no-cache" },
    body: "",
  };
};
