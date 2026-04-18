import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call, getApiKey, setApiKey } from "@/lib/api";

const ACTIONS: { group: string; items: { action: string; desc: string; params?: string }[] }[] = [
  {
    group: "Agents",
    items: [
      { action: "agent.register", desc: "Register a new AI agent", params: "{ name, role, emoji?, color? }" },
      { action: "agent.list", desc: "List all registered agents" },
      { action: "agent.heartbeat", desc: "Mark agent as online", params: "{ agent_id }" },
    ],
  },
  {
    group: "Tasks",
    items: [
      { action: "task.create", desc: "Create a task", params: "{ title, description?, assignee_id?, priority? }" },
      { action: "task.list", desc: "List all tasks" },
      { action: "task.move", desc: "Move a task between columns", params: "{ id, status }" },
      { action: "task.delete", desc: "Delete a task", params: "{ id }" },
    ],
  },
  {
    group: "Activity",
    items: [
      { action: "activity.log", desc: "Write to the activity log", params: "{ agent_id?, category, summary, details? }" },
      { action: "activity.list", desc: "Read the activity log", params: "{ limit? }" },
    ],
  },
  {
    group: "Forms",
    items: [
      { action: "form.create", desc: "Create a public form", params: "{ slug, title, description?, fields }" },
      { action: "form.list", desc: "List all forms" },
      { action: "form.submissions", desc: "List submissions for a form", params: "{ slug }" },
    ],
  },
  {
    group: "Webhooks",
    items: [
      { action: "webhook.create", desc: "Create a webhook endpoint", params: "{ name, description? }" },
      { action: "webhook.list", desc: "List all webhooks" },
      { action: "webhook.events", desc: "List events received by a webhook", params: "{ id }" },
    ],
  },
];

export default function Integrations() {
  const [key, setKey] = useState<string | null>(getApiKey());
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!key) {
      // First visit — bootstrap key
      void (async () => {
        try {
          const res = await call<{ api_key: string }>("auth.bootstrap");
          setApiKey(res.api_key);
          setKey(res.api_key);
        } catch {
          // noop
        }
      })();
    }
  }, [key]);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const displayedKey = key ?? "— bootstrapping —";
  const masked = show ? displayedKey : displayedKey.replace(/.(?=.{4})/g, "•");

  const curlExample = `curl -X POST ${baseUrl}/api/command \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayedKey}" \\
  -d '{"action":"activity.log","params":{"category":"email","summary":"Sent daily briefing"}}'`;

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Everything your agent needs to talk to this dashboard. Copy. Paste. Go."
      />

      <div className="grid grid-cols-2 gap-5 mb-8">
        <GlassCard>
          <div className="font-display text-sm tracking-widest uppercase text-white/70 mb-3">Your API Key</div>
          <div className="flex items-center gap-2 font-mono text-sm bg-black/30 border border-white/[0.06] rounded-lg px-3 py-2.5">
            <span className="flex-1 truncate text-primary">{masked}</span>
            <button onClick={() => setShow((s) => !s)} className="text-white/60 hover:text-white shrink-0">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              onClick={() => key && navigator.clipboard.writeText(key)}
              className="text-white/60 hover:text-white shrink-0"
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="text-xs text-white/40 mt-3">
            Paste this into your OpenClaw / Claude Code / Hermes agent. Keep it secret.
          </p>
        </GlassCard>

        <GlassCard>
          <div className="font-display text-sm tracking-widest uppercase text-white/70 mb-3">Base URL</div>
          <div className="flex items-center gap-2 font-mono text-sm bg-black/30 border border-white/[0.06] rounded-lg px-3 py-2.5">
            <span className="flex-1 truncate text-primary">{baseUrl}/api/command</span>
            <button
              onClick={() => navigator.clipboard.writeText(`${baseUrl}/api/command`)}
              className="text-white/60 hover:text-white shrink-0"
            >
              <Copy size={16} />
            </button>
          </div>
          <p className="text-xs text-white/40 mt-3">
            All agent actions POST to this single endpoint with <code>{'{ action, params }'}</code>.
          </p>
        </GlassCard>
      </div>

      <GlassCard className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-sm tracking-widest uppercase text-white/70">Quick Test — cURL</div>
          <button
            onClick={() => navigator.clipboard.writeText(curlExample)}
            className="text-xs flex items-center gap-1.5 text-primary hover:text-primary/80"
          >
            <Copy size={14} /> Copy
          </button>
        </div>
        <pre className="font-mono text-xs bg-black/40 border border-white/[0.06] rounded-lg p-4 text-white/80 overflow-x-auto whitespace-pre-wrap">
{curlExample}
        </pre>
      </GlassCard>

      <h2 className="font-display text-lg tracking-widest uppercase text-white/80 mb-4">Action Catalog</h2>
      <div className="flex flex-col gap-5">
        {ACTIONS.map((group) => (
          <GlassCard key={group.group}>
            <div className="font-display text-sm tracking-widest uppercase text-primary mb-3">{group.group}</div>
            <div className="divide-y divide-white/[0.06]">
              {group.items.map((a) => (
                <div key={a.action} className="py-3 flex items-start gap-6">
                  <code className="font-mono text-sm text-accent min-w-[200px] shrink-0">{a.action}</code>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white/90">{a.desc}</div>
                    {a.params && (
                      <code className="font-mono text-xs text-white/50 block mt-1">{a.params}</code>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-2 text-xs text-white/40">
        <RefreshCw size={12} />
        Want this as a single file your agent can read? Copy the base URL and action names above into your agent's skill file.
      </div>
    </>
  );
}
