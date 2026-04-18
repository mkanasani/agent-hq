import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { nanoid } from "nanoid";
import { store, readJson, writeJson } from "./lib/blobs";

const WEBHOOKS = "agent-hq-webhooks";
const WEBHOOK_EVENTS = "agent-hq-webhook-events";
const ACTIVITY = "agent-hq-activity";

export const handler: Handler = async (event) => {
  connectLambda(event);
  const webhookId = (event.path.split("/").pop() ?? "").trim();
  if (!webhookId) return { statusCode: 400, body: "Missing webhook id" };

  const s = store(WEBHOOKS);
  const existing = await readJson<{ name: string; event_count: number }>(s, webhookId);
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

  const activityId = nanoid(12);
  await writeJson(store(ACTIVITY), `${received_at}-${activityId}`, {
    id: activityId,
    agent_id: null,
    category: "system",
    summary: `Webhook "${existing.name}" received an event`,
    details: { event_id: id },
    created_at: received_at,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, event_id: id }),
  };
};
