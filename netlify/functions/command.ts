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
const VOICE_CONFIG = "agent-hq-voice-config";
const VOICE_SESSIONS = "agent-hq-voice-sessions";
const VOICE_INVITATIONS = "agent-hq-voice-invitations";

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
      case "agent.delete": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        await store(AGENTS).delete(id);
        await logActivity({ agent_id: null, category: "system", summary: `Agent ${id} deleted` });
        return ok({ id, deleted: true });
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
        const ALLOWED_TYPES = ["text", "email", "textarea", "tel", "url", "number", "date"];
        const normalizedFields = (fields as Array<Record<string, unknown>>).map((f, i) => {
          const label = String(f.label ?? f.name ?? `Field ${i + 1}`);
          const nameRaw = String(f.name ?? label);
          const name = nameRaw
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "") || `field_${i + 1}`;
          const typeRaw = String(f.type ?? "text").toLowerCase();
          const type = ALLOWED_TYPES.includes(typeRaw) ? typeRaw : "text";
          return {
            name,
            label,
            type,
            required: Boolean(f.required ?? false),
          };
        });
        const config = {
          slug,
          title,
          description,
          fields: normalizedFields,
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

      // ── VOICE CONFIG ──────────────────────────────────────────────
      case "voice.config.check": {
        const cfg = await readJson<{ gemini_key?: string }>(store(VOICE_CONFIG), "config");
        return ok({ configured: !!cfg?.gemini_key });
      }
      case "voice.config.get": {
        // Requires master-key auth so the Gemini key can reach the browser
        // WebRTC client that needs it to speak directly to Gemini Live.
        if (identity?.kind !== "master") {
          return fail(403, "voice.config.get requires the master API key");
        }
        const cfg = await readJson<{ gemini_key?: string }>(store(VOICE_CONFIG), "config");
        if (!cfg?.gemini_key) return fail(404, "No Gemini key stored yet");
        return ok({ gemini_key: cfg.gemini_key });
      }
      case "voice.config.set": {
        const { gemini_key } = params as Record<string, string>;
        if (!gemini_key || !gemini_key.trim()) return fail(400, "gemini_key required");
        await writeJson(store(VOICE_CONFIG), "config", {
          gemini_key: gemini_key.trim(),
          updated_at: new Date().toISOString(),
        });
        await logActivity({ agent_id: null, category: "system", summary: "Voice: Gemini key configured" });
        return ok({ configured: true });
      }
      case "voice.config.clear": {
        await store(VOICE_CONFIG).delete("config");
        return ok({ cleared: true });
      }

      // ── VOICE SESSIONS (past conversation transcripts) ────────────
      case "voice.session.save": {
        const { started_at, ended_at, transcripts, tools, invitation_id } = params as Record<string, unknown>;
        if (!started_at || !ended_at || !Array.isArray(transcripts)) {
          return fail(400, "started_at, ended_at, transcripts required");
        }
        const id = nanoid(12);
        const session = {
          id,
          started_at,
          ended_at,
          transcripts,
          tools: Array.isArray(tools) ? tools : [],
          invitation_id: invitation_id ?? null,
          duration_seconds: Math.round(
            (new Date(ended_at as string).getTime() - new Date(started_at as string).getTime()) / 1000,
          ),
        };
        await writeJson(store(VOICE_SESSIONS), `${started_at}-${id}`, session);
        const firstUser = (transcripts as Array<{ role: string; text: string }>).find(
          (t) => t.role === "user",
        );
        await logActivity({
          agent_id: null,
          category: "system",
          summary: `Voice session (${session.duration_seconds}s): ${firstUser?.text?.slice(0, 80) ?? "no user input"}`,
          details: { session_id: id },
        });
        return ok(session);
      }
      case "voice.session.list": {
        const { limit = 50 } = params as Record<string, number>;
        const all = await listJson<{ started_at: string }>(store(VOICE_SESSIONS));
        all.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
        return ok(all.slice(0, limit));
      }
      case "voice.session.get": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const all = await listJson<{ id: string }>(store(VOICE_SESSIONS));
        const found = all.find((s) => s.id === id);
        if (!found) return fail(404, "session not found");
        return ok(found);
      }
      case "voice.session.delete": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(VOICE_SESSIONS);
        const { blobs } = await s.list();
        for (const b of blobs) {
          const record = await readJson<{ id: string }>(s, b.key);
          if (record?.id === id) {
            await s.delete(b.key);
            return ok({ id, deleted: true });
          }
        }
        return fail(404, "session not found");
      }

      // ── VOICE INVITATIONS (agent → user "ring" requests) ────────────
      case "voice.invitation.create": {
        const { agent_name, reason, context } = params as Record<string, string>;
        if (!reason) return fail(400, "reason required");
        const id = nanoid(12);
        const invitation = {
          id,
          agent_name: agent_name ?? (identity?.kind === "agent" ? identity.sign_in_name : "Unknown Agent"),
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          reason,
          context: context ?? "",
          status: "pending",
          created_at: new Date().toISOString(),
        };
        await writeJson(store(VOICE_INVITATIONS), id, invitation);
        await logActivity({
          agent_id: invitation.agent_id,
          category: "decision",
          summary: `${invitation.agent_name} wants to talk: ${reason.slice(0, 80)}`,
          details: { invitation_id: id },
        });
        return ok(invitation);
      }
      case "voice.invitation.list": {
        const all = await listJson<{ created_at: string; status: string }>(store(VOICE_INVITATIONS));
        const pending = all.filter((i) => i.status === "pending");
        pending.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return ok(pending);
      }
      case "voice.invitation.get": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const record = await readJson(store(VOICE_INVITATIONS), id);
        if (!record) return fail(404, "invitation not found");
        return ok(record);
      }
      case "voice.invitation.dismiss": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(VOICE_INVITATIONS);
        const record = await readJson<Record<string, unknown>>(s, id);
        if (!record) return fail(404, "invitation not found");
        await writeJson(s, id, { ...record, status: "dismissed" });
        return ok({ id, status: "dismissed" });
      }
      case "voice.invitation.accept": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(VOICE_INVITATIONS);
        const record = await readJson<Record<string, unknown>>(s, id);
        if (!record) return fail(404, "invitation not found");
        await writeJson(s, id, { ...record, status: "accepted", accepted_at: new Date().toISOString() });
        return ok(record);
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
