import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { nanoid } from "nanoid";
import { store, readJson, writeJson, listJson } from "./lib/blobs";
import { getOrCreateApiKey, identifyApiKey, createAgentKey } from "./lib/auth";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

type Req = { action: string; params?: Record<string, unknown> };

const json = (status: number, body: unknown) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});

const ok = (data: unknown) => json(200, { ok: true, data });
const fail = (status: number, error: string) => json(status, { ok: false, error });

const AGENTS = "agent-hq-agents";
const TASKS = "agent-hq-tasks";
const ACTIVITY = "agent-hq-activity";
const FORMS = "agent-hq-forms";
const SUBMISSIONS = "agent-hq-submissions";
const WEBHOOKS = "agent-hq-webhooks";
const WEBHOOK_EVENTS = "agent-hq-webhook-events";

// Write activity log row — fire and forget.
async function logActivity(entry: {
  agent_id?: string | null;
  category: string;
  summary: string;
  details?: Record<string, unknown> | null;
}) {
  const id = nanoid(12);
  const created_at = new Date().toISOString();
  const key = `${created_at}-${id}`;
  await writeJson(store(ACTIVITY), key, { id, created_at, ...entry });
}

export const handler: Handler = async (event) => {
  // v1 Lambda-compat functions need this to wire up Blobs from the event headers
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }
  if (event.httpMethod !== "POST") return fail(405, "Method not allowed");

  // Public actions that do not require an API key.
  const PUBLIC_ACTIONS = new Set(["auth.bootstrap"]);

  // Outer try/catch — ensures the function always returns JSON, never a bare
  // runtime error (which Netlify serves as an empty 500).
  try {
    let req: Req;
    try {
      req = JSON.parse(event.body ?? "{}");
    } catch {
      return fail(400, "Invalid JSON");
    }
    const { action, params = {} } = req;
    if (!action) return fail(400, "Missing 'action'");

    const rawKey = event.headers["x-api-key"] ?? event.headers["X-API-Key"] ?? null;
    const identity = await identifyApiKey(typeof rawKey === "string" ? rawKey : null);
    if (!PUBLIC_ACTIONS.has(action) && !identity) {
      return fail(401, "Invalid or missing X-API-Key");
    }

    switch (action) {
      // ── AUTH ──────────────────────────────────────────────
      case "auth.bootstrap": {
        // First-visit endpoint. Returns the API key if caller includes the deploy secret,
        // OR if no key has been issued yet (first visit from the owner).
        const apiKey = await getOrCreateApiKey();
        return ok({ api_key: apiKey });
      }

      // ── AGENTS ──────────────────────────────────────────────
      case "agent.register": {
        const { name, role, emoji = "🤖", color = "#00BFFF", sign_in_name: requested } =
          params as Record<string, string>;
        if (!name) return fail(400, "name required");
        const id = nanoid(10);
        const now = new Date().toISOString();
        const sign_in_name = slugify(requested || name) + "-" + id.slice(0, 4);
        const api_key = await createAgentKey(id, sign_in_name);
        const agent = {
          id,
          name,
          sign_in_name,
          api_key,
          role: role ?? "Generalist",
          emoji,
          color,
          status: "online",
          last_heartbeat: now,
          created_at: now,
        };
        await writeJson(store(AGENTS), id, agent);
        await logActivity({ agent_id: id, category: "system", summary: `Agent "${name}" registered as @${sign_in_name}` });
        return ok(agent);
      }
      case "agent.list": {
        const agents = await listJson(store(AGENTS));
        return ok(agents);
      }
      case "agent.heartbeat": {
        const { agent_id } = params as Record<string, string>;
        if (!agent_id) return fail(400, "agent_id required");
        const s = store(AGENTS);
        const existing = await readJson<Record<string, unknown>>(s, agent_id);
        if (!existing) return fail(404, "agent not found");
        const updated = { ...existing, status: "online", last_heartbeat: new Date().toISOString() };
        await writeJson(s, agent_id, updated);
        return ok(updated);
      }

      // ── TASKS ──────────────────────────────────────────────
      case "task.create": {
        const { title, description, assignee_id, priority = "medium" } = params as Record<string, string>;
        if (!title) return fail(400, "title required");
        const id = nanoid(10);
        const now = new Date().toISOString();
        const task = {
          id,
          title,
          description: description ?? null,
          status: "todo",
          assignee_id: assignee_id ?? null,
          priority,
          created_at: now,
          updated_at: now,
        };
        await writeJson(store(TASKS), id, task);
        await logActivity({ agent_id: assignee_id ?? null, category: "task", summary: `Task created: "${title}"` });
        return ok(task);
      }
      case "task.list": {
        const tasks = await listJson(store(TASKS));
        return ok(tasks);
      }
      case "task.move": {
        const { id, status } = params as Record<string, string>;
        if (!id || !status) return fail(400, "id and status required");
        const s = store(TASKS);
        const existing = await readJson<Record<string, unknown>>(s, id);
        if (!existing) return fail(404, "task not found");
        const updated = { ...existing, status, updated_at: new Date().toISOString() };
        await writeJson(s, id, updated);
        await logActivity({
          agent_id: (existing.assignee_id as string) ?? null,
          category: "task",
          summary: `Task "${existing.title}" → ${status}`,
        });
        return ok(updated);
      }
      case "task.delete": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        await store(TASKS).delete(id);
        return ok({ id, deleted: true });
      }

      // ── ACTIVITY ──────────────────────────────────────────────
      case "activity.log": {
        const { agent_id, category, summary, details } = params as Record<string, unknown>;
        if (!summary || !category) return fail(400, "category and summary required");
        await logActivity({
          agent_id: (agent_id as string) ?? null,
          category: category as string,
          summary: summary as string,
          details: (details as Record<string, unknown>) ?? null,
        });
        return ok({ logged: true });
      }
      case "activity.list": {
        const { limit = 100 } = params as Record<string, number>;
        const rows = await listJson<{ created_at: string }>(store(ACTIVITY));
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return ok(rows.slice(0, limit));
      }

      // ── FORMS ──────────────────────────────────────────────
      case "form.create": {
        const { slug, title, description = "", fields } = params as Record<string, unknown>;
        if (!slug || !title || !Array.isArray(fields)) return fail(400, "slug, title, fields required");
        const config = {
          slug,
          title,
          description,
          fields,
          created_at: new Date().toISOString(),
        };
        await writeJson(store(FORMS), slug as string, config);
        return ok(config);
      }
      case "form.list": {
        return ok(await listJson(store(FORMS)));
      }
      case "form.submissions": {
        const { slug } = params as Record<string, string>;
        if (!slug) return fail(400, "slug required");
        return ok(await listJson(store(SUBMISSIONS), `${slug}/`));
      }

      // ── WEBHOOKS ──────────────────────────────────────────────
      case "webhook.create": {
        const { name, description = "" } = params as Record<string, string>;
        if (!name) return fail(400, "name required");
        const id = nanoid(12);
        const w = { id, name, description, event_count: 0, created_at: new Date().toISOString() };
        await writeJson(store(WEBHOOKS), id, w);
        return ok(w);
      }
      case "webhook.list": {
        return ok(await listJson(store(WEBHOOKS)));
      }
      case "webhook.events": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        return ok(await listJson(store(WEBHOOK_EVENTS), `${id}/`));
      }

      default:
        return fail(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[command] handler error:", message, stack);
    return fail(500, message);
  }
};
