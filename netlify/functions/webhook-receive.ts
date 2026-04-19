import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { nanoid } from "nanoid";
import { store, readJson, writeJson, listJson } from "./lib/blobs";

const WEBHOOKS = "agent-hq-webhooks";
const WEBHOOK_EVENTS = "agent-hq-webhook-events";
const ACTIVITY = "agent-hq-activity";
const OUTREACH_CAMPAIGNS = "agent-hq-outreach-campaigns";
const OUTREACH_EMAILS = "agent-hq-outreach-emails";
const OUTREACH_REPLIES = "agent-hq-outreach-replies";

type WebhookRecord = {
  name: string;
  event_count: number;
  service?: string; // "agentmail" triggers the specialised processor below
};

// Each message.* event nests the message-identification object under a
// different top-level key — message.sent → send, message.delivered →
// delivery, message.bounced → bounce, message.complained → complaint,
// message.rejected → rejection, message.received → message.
// We probe all of them so the handler doesn't silently drop events when
// AgentMail introduces a new shape or we guess wrong.
type AgentMailIdCarrier = {
  message_id?: string;
  thread_id?: string;
  inbox_id?: string;
  recipients?: string[];
  timestamp?: string;
};

type AgentMailEvent = {
  type?: string;
  event_type?: string;
  event_id?: string;
  send?: AgentMailIdCarrier;
  delivery?: AgentMailIdCarrier;
  bounce?: AgentMailIdCarrier & { type?: string; sub_type?: string };
  complaint?: AgentMailIdCarrier;
  rejection?: AgentMailIdCarrier;
  message?: {
    message_id?: string;
    thread_id?: string;
    inbox_id?: string;
    subject?: string;
    from?: string;
    to?: string[];
    text?: string;
    html?: string;
    timestamp?: string;
  };
  thread?: { thread_id?: string };
};

function extractIds(event: AgentMailEvent): { messageId?: string; threadId?: string } {
  const carriers = [event.send, event.delivery, event.bounce, event.complaint, event.rejection];
  for (const c of carriers) {
    if (c?.message_id || c?.thread_id) {
      return { messageId: c.message_id, threadId: c.thread_id };
    }
  }
  return {};
}

// Status rank controls forward-only progression so out-of-order webhooks
// (e.g. delivered arriving before sent finishes writing) don't regress a
// replied email back to sent. Negative terminal states (bounced/complained/
// failed) always win regardless of prior state.
function statusRank(s: string | undefined): number {
  return (
    ({
      drafted: 0,
      sent: 1,
      delivered: 2,
      clicked: 3,
      replied: 4,
    } as Record<string, number>)[s ?? ""] ?? 0
  );
}

function shouldAdvanceStatus(current: string | undefined, next: string): boolean {
  if (["bounced", "complained", "failed"].includes(next)) return true;
  return statusRank(next) >= statusRank(current);
}

/**
 * Find the outreach email record that corresponds to an AgentMail message
 * or thread identifier. We match on agentmail_message_id first, then fall
 * back to agentmail_thread_id (for replies that come in on the same thread).
 */
async function findOutreachEmailByAgentMailIds(
  messageId: string | undefined,
  threadId: string | undefined,
): Promise<{ storeKey: string; record: Record<string, unknown> } | null> {
  if (!messageId && !threadId) return null;
  const es = store(OUTREACH_EMAILS);
  const { blobs } = await es.list();
  for (const b of blobs) {
    const row = await readJson<Record<string, unknown>>(es, b.key);
    if (!row) continue;
    if (messageId && row.agentmail_message_id === messageId) return { storeKey: b.key, record: row };
    if (threadId && row.agentmail_thread_id === threadId) return { storeKey: b.key, record: row };
  }
  return null;
}

/**
 * AgentMail event handler. Updates per-email status + per-campaign counters
 * and — for inbound replies — stores the full reply content so the /inbox
 * page can render it. Keep this resilient to unknown event_types: if we
 * don't recognise the event, we still log it to the generic audit trail.
 */
async function processAgentMailEvent(event: AgentMailEvent): Promise<void> {
  const eventType = event.event_type ?? "";
  const message = event.message;

  // Outbound send-lifecycle events — each one nests identifiers under a
  // different key (send/delivery/bounce/complaint/rejection). We probe
  // all carriers rather than assuming one shape.
  const OUTBOUND = ["message.sent", "message.delivered", "message.bounced", "message.complained", "message.rejected"];
  if (OUTBOUND.includes(eventType)) {
    const { messageId, threadId } = extractIds(event);
    if (!messageId && !threadId) return;
    const match = await findOutreachEmailByAgentMailIds(messageId, threadId);
    if (!match) return;
    const newStatus =
      eventType === "message.delivered" ? "delivered" :
      eventType === "message.bounced" ? "bounced" :
      eventType === "message.complained" ? "complained" :
      eventType === "message.rejected" ? "failed" :
      "sent";
    const currentStatus = match.record.status as string | undefined;
    if (!shouldAdvanceStatus(currentStatus, newStatus)) return; // ignore out-of-order events

    const updatedEmail = {
      ...match.record,
      status: newStatus,
      [`${newStatus}_at`]: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeJson(store(OUTREACH_EMAILS), match.storeKey, updatedEmail);

    // Cached campaign counters are race-prone under concurrent webhooks;
    // the UI derives its counters from emails directly. We still bump
    // the cache for analytics.summary back-compat but the derived values
    // are the source of truth.
    const campaignId = match.record.campaign_id as string;
    if (campaignId) {
      const cs = store(OUTREACH_CAMPAIGNS);
      const campaign = await readJson<Record<string, unknown>>(cs, campaignId);
      if (campaign) {
        const counterKey =
          eventType === "message.delivered" ? "emails_delivered" :
          eventType === "message.bounced" ? "emails_bounced" :
          null;
        if (counterKey) {
          await writeJson(cs, campaignId, {
            ...campaign,
            [counterKey]: (campaign[counterKey] as number ?? 0) + 1,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
    return;
  }

  // Inbound reply — store under OUTREACH_REPLIES and bump replied counter.
  if (eventType === "message.received" && message) {
    const match = await findOutreachEmailByAgentMailIds(undefined, message.thread_id);
    const campaignId = (match?.record.campaign_id as string) ?? null;
    const replyId = nanoid(12);
    const receivedAt = message.timestamp ?? new Date().toISOString();
    const reply = {
      id: replyId,
      campaign_id: campaignId,
      lead_id: match?.record.lead_id ?? null,
      original_email_id: match?.record.id ?? null,
      agentmail_message_id: message.message_id ?? null,
      agentmail_thread_id: message.thread_id ?? null,
      from: message.from ?? null,
      to: message.to ?? null,
      subject: message.subject ?? null,
      text: message.text ?? null,
      html: message.html ?? null,
      received_at: receivedAt,
      handled: false, // set true once user converts to task or dismisses
    };
    // Keyed by (campaign | unassigned)/timestamp-id for cheap per-campaign listing.
    const prefix = campaignId ?? "unassigned";
    await writeJson(store(OUTREACH_REPLIES), `${prefix}/${receivedAt}-${replyId}`, reply);

    if (match) {
      await writeJson(store(OUTREACH_EMAILS), match.storeKey, {
        ...match.record,
        status: "replied",
        replied_at: receivedAt,
        updated_at: new Date().toISOString(),
      });
      if (campaignId) {
        const cs = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(cs, campaignId);
        if (campaign) {
          await writeJson(cs, campaignId, {
            ...campaign,
            emails_replied: (campaign.emails_replied as number ?? 0) + 1,
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    // Surface in activity so the Office page ticker picks it up.
    const activityId = nanoid(12);
    await writeJson(store(ACTIVITY), `${receivedAt}-${activityId}`, {
      id: activityId,
      agent_id: null,
      category: "email",
      summary: `Reply from ${message.from ?? "unknown"}: ${(message.subject ?? "(no subject)").slice(0, 80)}`,
      details: { reply_id: replyId, campaign_id: campaignId },
      created_at: receivedAt,
    });
  }
}

export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);
  const webhookId = (event.path.split("/").pop() ?? "").trim();
  if (!webhookId) return { statusCode: 400, body: "Missing webhook id" };

  const s = store(WEBHOOKS);
  const existing = await readJson<WebhookRecord>(s, webhookId);
  if (!existing) return { statusCode: 404, body: "Webhook not found" };

  let body: unknown = null;
  try {
    body = event.body ? JSON.parse(event.body) : null;
  } catch {
    body = event.body;
  }

  const id = nanoid(12);
  const received_at = new Date().toISOString();
  await writeJson(store(WEBHOOK_EVENTS), `${webhookId}/${received_at}-${id}`, {
    id,
    webhook_id: webhookId,
    headers: event.headers,
    body,
    received_at,
  });

  await writeJson(s, webhookId, {
    ...existing,
    event_count: (existing.event_count ?? 0) + 1,
  });

  // Specialised processor for AgentMail-tagged webhooks. We still log the
  // raw event above (for the generic Webhooks page audit trail) — this
  // just adds the outreach-domain side effects on top.
  try {
    const tagged = existing.service === "agentmail";
    const looksLikeAgentMail = typeof body === "object" && body !== null && (body as AgentMailEvent).event_type?.startsWith("message.");
    if (tagged || looksLikeAgentMail) {
      await processAgentMailEvent(body as AgentMailEvent);
    }
  } catch (err) {
    console.error("[webhook-receive] AgentMail processor error:", err);
    // Fall through — we still 200'd the raw event capture above.
  }

  const activityId = nanoid(12);
  await writeJson(store(ACTIVITY), `${received_at}-${activityId}`, {
    id: activityId,
    agent_id: null,
    category: "system",
    summary: `Webhook "${existing.name}" received an event`,
    details: { event_id: id, service: existing.service ?? "generic" },
    created_at: received_at,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, event_id: id }),
  };
};

// Small helper — compiled out at runtime, kept here to prove intent.
export const __listJson = listJson;
