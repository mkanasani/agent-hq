import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  CheckCheck,
  Terminal,
  Brain,
  KeyRound,
  Link as LinkIcon,
  Sparkles,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GlassCard from "@/components/GlassCard";
import { call, getApiKey, setApiKey } from "@/lib/api";
import { copyToClipboard } from "@/lib/utils";

type ActionSpec = { action: string; desc: string; params?: string };
type ActionGroup = { group: string; items: ActionSpec[] };

const ACTIONS: ActionGroup[] = [
  {
    group: "Agents",
    items: [
      { action: "agent.register", desc: "Register yourself as a new AI agent. Returns { id, sign_in_name, api_key }.", params: "{ name, role, emoji?, color? }" },
      { action: "agent.list", desc: "List all registered agents" },
      { action: "agent.heartbeat", desc: "Mark yourself as online (call every 1-5 min while active)", params: "{ agent_id }" },
    ],
  },
  {
    group: "Tasks",
    items: [
      { action: "task.create", desc: "Create a task card. Shows up on the kanban board.", params: "{ title, description?, assignee_id?, priority? }" },
      { action: "task.list", desc: "List all tasks" },
      { action: "task.move", desc: "Move a task between columns: todo, doing, needs_input, canceled, done", params: "{ id, status }" },
      { action: "task.delete", desc: "Delete a task", params: "{ id }" },
    ],
  },
  {
    group: "Activity",
    items: [
      { action: "activity.log", desc: "Log a meaningful action. Categories: task, research, email, content, decision, error, system.", params: "{ agent_id?, category, summary, details? }" },
      { action: "activity.list", desc: "Read the activity log (most recent first)", params: "{ limit? }" },
    ],
  },
  {
    group: "Forms",
    items: [
      {
        action: "form.create",
        desc: "Create a public form at /form/:slug. Each field object MUST include { name, label, type, required }. Types: text, email, textarea, tel, url, number, date.",
        params: "{ slug, title, description?, fields: [{ name, label, type, required }] }",
      },
      { action: "form.list", desc: "List all forms" },
      { action: "form.submissions", desc: "List submissions for a form", params: "{ slug }" },
    ],
  },
  {
    group: "Webhooks",
    items: [
      { action: "webhook.create", desc: "Create a catch-all inbound URL at /api/webhook/:id", params: "{ name, description? }" },
      { action: "webhook.list", desc: "List all webhooks" },
      { action: "webhook.events", desc: "List events received by a webhook", params: "{ id }" },
    ],
  },
  {
    group: "Voice",
    items: [
      {
        action: "voice.invitation.create",
        desc: "Ring the dashboard — trigger an 'incoming call' banner so the human can answer and have a live voice conversation with full context of why you're calling. This is how you page the user for urgent decisions or briefings.",
        params: "{ agent_name?, reason, context? }",
      },
      { action: "voice.invitation.list", desc: "List pending voice invitations" },
      { action: "voice.session.list", desc: "Read past voice conversation transcripts", params: "{ limit? }" },
      { action: "voice.session.get", desc: "Get one transcript by id", params: "{ id }" },
    ],
  },
  {
    group: "Pages (landing pages)",
    items: [
      {
        action: "page.create",
        desc: "Publish a landing page at /p/<slug>. Pair with form.create to embed a form inline via {{form:<slug>}} marker. The theme wrapper handles typography, layout, and dark-futuristic glow — you just write the semantic HTML body.",
        params: "{ slug, title, html_body, linked_form_slug?, accent? }",
      },
      { action: "page.list", desc: "List all published pages" },
      { action: "page.get", desc: "Get one page's record", params: "{ slug }" },
      {
        action: "page.update",
        desc: "Replace page content in place — same URL, updated markup. Use for iteration.",
        params: "{ slug, html_body?, title?, accent? }",
      },
      { action: "page.delete", desc: "Unpublish a page", params: "{ slug }" },
    ],
  },
];

function buildFullGuide(baseUrl: string, apiKey: string): string {
  const actions = ACTIONS.flatMap((g) =>
    g.items.map((a) => `- \`${a.action}\` — ${a.desc}${a.params ? `\n  params: \`${a.params}\`` : ""}`),
  ).join("\n");

  return `# AgentHQ Integration Guide

You have access to an AgentHQ mission control dashboard. Every action you take
can be logged, shown to the human operator, and tracked over time.

## Credentials

- **Base URL:** ${baseUrl}/api/command
- **Master API Key:** ${apiKey}

## How every call works

\`\`\`
POST ${baseUrl}/api/command
Headers:
  Content-Type: application/json
  X-API-Key: ${apiKey}
Body:
  {"action": "<group.verb>", "params": { ... }}
\`\`\`

Every response is \`{"ok": true, "data": ...}\` on success or
\`{"ok": false, "error": "..."}\` on failure.

## Voice invitations — how to page the human

You can literally ring the user's dashboard. Call \`voice.invitation.create\` with:

- \`agent_name\` — the name to show in the banner (auto-filled from your sign-in name if you use an agent key)
- \`reason\` — one-line pitch shown in the banner (what you want to talk about)
- \`context\` — the full briefing; becomes part of the voice agent's system prompt so it opens the conversation naturally with the human

When the human clicks **Answer**, a voice session starts with your context baked in. The voice agent speaks first with a natural greeting, the human responds, and every tool call during the conversation is attributed and logged.

**Example:**

\`\`\`bash
curl -X POST $AGENT_HQ_URL/api/command \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $AGENT_HQ_KEY" \\
  -d '{
    "action":"voice.invitation.create",
    "params":{
      "agent_name":"Nova",
      "reason":"3 hot leads need your approval before I send",
      "context":"I researched 8 prospects matching the ICP. Top 3: Acme Corp (enterprise, $50K ARR potential), Linear (mid-market, fits our case study), Stripe (strategic). Drafts are ready. Need you to approve tone + any edits before I send tonight."
    }
  }'
\`\`\`

## Field schemas — read before you call these actions

### \`form.create\` field objects

Each entry in \`fields\` MUST include all four keys:

\`\`\`json
{
  "name": "full_name",
  "label": "Full Name",
  "type": "text",
  "required": true
}
\`\`\`

- \`name\` — machine slug used as the submission key. Lowercase, underscores only.
- \`label\` — human-readable label shown above the input.
- \`type\` — one of: \`text\`, \`email\`, \`textarea\`, \`tel\`, \`url\`, \`number\`, \`date\`. Anything else is coerced to \`text\`.
- \`required\` — boolean.

If you omit \`name\`, the server will auto-derive it from \`label\`, but you should set it explicitly so your form.submissions downstream know which key to read.

### \`activity.log\` categories

Valid values for \`category\`: \`task\`, \`research\`, \`email\`, \`content\`, \`decision\`, \`error\`, \`system\`. Anything else is accepted but won't get a coloured pill on the dashboard.

### \`task.move\` statuses

Valid values for \`status\`: \`todo\`, \`doing\`, \`needs_input\`, \`canceled\`, \`done\`.

## Quick start

1. **Register yourself** so activity is attributed to you:

\`\`\`bash
curl -X POST ${baseUrl}/api/command \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${apiKey}" \\
  -d '{"action":"agent.register","params":{"name":"Atlas","role":"Executive Assistant","emoji":"🧭"}}'
\`\`\`

You'll receive your own \`api_key\` — use it for all future calls so the
dashboard knows who you are.

2. **Log your first activity:**

\`\`\`bash
curl -X POST ${baseUrl}/api/command \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: <your agent api_key>" \\
  -d '{"action":"activity.log","params":{"category":"system","summary":"I just came online"}}'
\`\`\`

## Full action catalog

${actions}

## Authentication

Two key types work:

- **Master key** (\`ahq_...\`) — admin, can do anything including register new agents
- **Agent key** (\`akey_...\`) — scoped to one agent, actions auto-attribute to that agent

Prefer the agent key for day-to-day operations.

## Public endpoints (no key needed)

- \`GET/POST ${baseUrl}/api/form/<slug>\` — public form intake
- \`POST ${baseUrl}/api/webhook/<id>\` — catch-all webhook receiver
`;
}

function buildAgentPrompt(baseUrl: string, apiKey: string): string {
  return `You are connected to an AgentHQ dashboard — a visual mission control
where the human operator watches your work in real time.

ENDPOINT: ${baseUrl}/api/command
API_KEY:  ${apiKey}

Every tool-use action is an HTTP POST to the endpoint above with:
  Header: X-API-Key: <api key>
  Body:   {"action": "<group.verb>", "params": {...}}

═══════════════════════════════════════════════════════════════
FIRST ACTION ON STARTUP — register yourself if you haven't yet:
═══════════════════════════════════════════════════════════════

POST ${baseUrl}/api/command
{"action":"agent.register","params":{"name":"<YOUR NAME>","role":"<YOUR ROLE>","emoji":"<EMOJI>"}}

You'll get back { id, sign_in_name, api_key }. Save the api_key and use it
for every call after this one — activities will auto-attribute to you.

═══════════════════════════════════════════════════════════════
ALWAYS LOG WHAT YOU DO — the human can only see what you log.
═══════════════════════════════════════════════════════════════

After any meaningful step (email sent, research done, file created, decision
made), POST an activity log entry:

{"action":"activity.log","params":{"category":"<cat>","summary":"<one line>"}}

Categories: task, research, email, content, decision, error, system.
Keep summaries short and specific. Example:
  "Drafted 5 content pieces from blog URL"
  "Decided NOT to send email — waiting for user approval"
  "Errored on SendGrid call — rate limited, retrying in 60s"

═══════════════════════════════════════════════════════════════
CREATE A TASK CARD for anything substantive.
═══════════════════════════════════════════════════════════════

When the user asks you to do something non-trivial, create a task so it's
visible on the kanban:

{"action":"task.create","params":{"title":"<title>","priority":"<low|medium|high>"}}

Move it as you work:
  doing        → you're actively working on it
  needs_input  → you're blocked on the human
  done         → complete

{"action":"task.move","params":{"id":"<task id>","status":"done"}}

═══════════════════════════════════════════════════════════════
FULL ACTION CATALOG
═══════════════════════════════════════════════════════════════

Agents:
  agent.register     { name, role, emoji?, color? }
  agent.list
  agent.heartbeat    { agent_id }
  agent.delete       { id }

Tasks:
  task.create        { title, description?, assignee_id?, priority? }
  task.list
  task.move          { id, status }   status ∈ todo|doing|needs_input|canceled|done
  task.delete        { id }

Activity:
  activity.log       { agent_id?, category, summary, details? }
                     category ∈ task|research|email|content|decision|error|system
  activity.list      { limit? }

Forms:
  form.create        { slug, title, description?, fields }
                     fields: [{ name, label, type, required }]
                     type ∈ text|email|textarea|tel|url|number|date
                     name MUST be a lowercase machine slug (e.g. full_name)
  form.list
  form.submissions   { slug }

Webhooks:
  webhook.create     { name, description? }
  webhook.list
  webhook.events     { id }

Voice:
  voice.invitation.create   { agent_name?, reason, context? }
                            Triggers an "incoming call" banner in the
                            user's dashboard. When they answer, a live
                            voice conversation starts with your context
                            pre-loaded. Use this when you need a decision,
                            want to brief the human, or have something
                            that can't wait in a task queue.
  voice.invitation.list
  voice.session.list        Returns past conversation transcripts
  voice.session.get         { id }

Pages (landing pages):
  page.create      { slug, title, html_body, linked_form_slug?, accent? }
                   Publishes a landing page at /p/<slug>. Theme wrapper
                   supplies fonts, CSS, layout. You write the semantic HTML
                   body. Use {{form:<slug>}} marker to embed a form inline.
                   Class conventions: .hero, .features, .card, .button,
                   .button.ghost, .stat, .eyebrow, .cta-row, footer.
                   Chain after form.create for one-shot lead capture pages.
  page.list
  page.update      { slug, html_body?, title?, accent? }  Replace in place
  page.delete      { slug }

═══════════════════════════════════════════════════════════════
FIELD SCHEMA — form.create (READ THIS)
═══════════════════════════════════════════════════════════════

Every field object needs all four keys:

{ "name": "full_name", "label": "Full Name", "type": "text", "required": true }

- name: lowercase slug, underscores only. This is the key you'll see in
  form.submissions results — NEVER omit it or your downstream queries break.
- label: the human-readable text rendered above the input.
- type: text | email | textarea | tel | url | number | date
        Unknown types get coerced to "text" — don't rely on this.
- required: boolean

═══════════════════════════════════════════════════════════════
RESPONSE SHAPE
═══════════════════════════════════════════════════════════════

Success: {"ok": true, "data": ...}
Failure: {"ok": false, "error": "..."}

Never swallow errors — log them as activity entries with category "error".`;
}

export default function Integrations() {
  const [key, setKey] = useState<string | null>(getApiKey());
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
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
  const displayedKey = key ?? "ahq_loading...";
  const masked = show ? displayedKey : displayedKey.replace(/.(?=.{4})/g, "•");

  const fullGuide = useMemo(() => buildFullGuide(baseUrl, displayedKey), [baseUrl, displayedKey]);
  const agentPrompt = useMemo(() => buildAgentPrompt(baseUrl, displayedKey), [baseUrl, displayedKey]);

  const curlExample = `curl -X POST ${baseUrl}/api/command \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayedKey}" \\
  -d '{"action":"activity.log","params":{"category":"system","summary":"Hello from my agent"}}'`;

  const [fallback, setFallback] = useState<{ label: string; text: string } | null>(null);

  async function copy(label: string, value: string) {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 2000);
    } else {
      // Neither clipboard API nor execCommand worked — surface a manual-copy modal
      setFallback({ label, text: value });
    }
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Plug any agent — OpenClaw, Claude Code, Hermes, Python, cURL — into this dashboard in under two minutes."
      />

      {/* ── HERO: ONE-CLICK GIVES ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-5 mb-8">
        <BigCopyCard
          icon={Brain}
          accent="primary"
          title="Agent System Prompt"
          desc="Paste this into your agent's skill file, SOUL.md, or system prompt. Works with OpenClaw, Claude Code, Hermes, or any LLM-powered agent."
          buttonLabel={copied === "prompt" ? "Copied — paste into your agent" : "Copy Agent System Prompt"}
          copied={copied === "prompt"}
          onCopy={() => void copy("prompt", agentPrompt)}
        />
        <BigCopyCard
          icon={Sparkles}
          accent="purple"
          title="Full Integration Guide"
          desc="The complete markdown doc — base URL, API key, every action, cURL examples. Drop into your agent's context or a SKILL.md file."
          buttonLabel={copied === "guide" ? "Copied — paste anywhere" : "Copy Full Integration Guide"}
          copied={copied === "guide"}
          onCopy={() => void copy("guide", fullGuide)}
        />
      </div>

      {/* ── CREDENTIALS ──────────────────────────────── */}
      <h2 className="font-display text-sm tracking-widest text-white font-bold mb-4 uppercase flex items-center gap-2">
        <KeyRound size={14} className="text-primary" strokeWidth={2.5} /> Your Credentials
      </h2>
      <div className="grid grid-cols-2 gap-5 mb-8">
        <CredentialCard
          label="Base URL"
          value={`${baseUrl}/api/command`}
          icon={LinkIcon}
          hint="All agent actions POST to this single endpoint."
          onCopy={() => void copy("baseurl", `${baseUrl}/api/command`)}
          copied={copied === "baseurl"}
        />
        <CredentialCard
          label="Master API Key"
          value={masked}
          realValue={displayedKey}
          icon={KeyRound}
          hint="Admin access. Share only with agents you trust — or register per-agent keys on the Agents page."
          show={show}
          onToggleShow={() => setShow((s) => !s)}
          onCopy={() => void copy("masterkey", displayedKey)}
          copied={copied === "masterkey"}
        />
      </div>

      {/* ── CURL TEST ──────────────────────────────── */}
      <GlassCard className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-sm tracking-widest text-white font-bold uppercase flex items-center gap-2">
            <Terminal size={14} className="text-accent" strokeWidth={2.5} /> Try It Now — cURL
          </div>
          <CopyPill
            label={copied === "curl" ? "Copied" : "Copy"}
            copied={copied === "curl"}
            onClick={() => void copy("curl", curlExample)}
          />
        </div>
        <pre className="font-mono text-xs bg-black/60 border border-white/[0.08] rounded-lg p-4 text-white/95 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{curlExample}
        </pre>
        <p className="text-xs text-white/70 mt-3 font-medium">
          Run this and watch the <span className="text-primary font-bold">Activity</span> page —
          your event shows up instantly.
        </p>
      </GlassCard>

      {/* ── MANUAL COPY FALLBACK ──────────────────────────────── */}
      {fallback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setFallback(null)}
          />
          <div className="relative glass p-6 max-w-3xl w-full">
            <h3 className="font-display text-lg font-bold mb-2">Copy manually</h3>
            <p className="text-sm text-white/75 font-medium mb-4">
              Your browser blocked the automatic copy. Select the text below (Cmd+A / Ctrl+A)
              and copy it (Cmd+C / Ctrl+C).
            </p>
            <textarea
              readOnly
              value={fallback.text}
              className="w-full h-80 bg-black/60 border border-white/10 rounded-lg p-4 text-xs font-mono text-white/95"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => setFallback(null)}
                className="px-4 py-2.5 rounded-xl bg-primary text-black font-display font-black tracking-widest text-sm uppercase"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ACTION CATALOG ──────────────────────────────── */}
      <h2 className="font-display text-sm tracking-widest text-white font-bold mb-4 uppercase">
        Action Catalog
      </h2>
      <div className="flex flex-col gap-5">
        {ACTIONS.map((group) => (
          <GlassCard key={group.group}>
            <div className="font-display text-sm tracking-widest uppercase text-primary font-bold mb-4">
              {group.group}
            </div>
            <div className="divide-y divide-white/[0.06]">
              {group.items.map((a) => (
                <div key={a.action} className="py-3 flex items-start gap-6">
                  <code className="font-mono text-sm text-accent font-bold min-w-[200px] shrink-0">
                    {a.action}
                  </code>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium">{a.desc}</div>
                    {a.params && (
                      <code className="font-mono text-xs text-white/70 block mt-1.5 font-semibold">
                        params: {a.params}
                      </code>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      void copy(
                        `act-${a.action}`,
                        `POST ${baseUrl}/api/command\nX-API-Key: ${displayedKey}\n\n{"action":"${a.action}","params":${a.params ?? "{}"}}`,
                      )
                    }
                    className="text-white/50 hover:text-primary transition shrink-0"
                    title="Copy template"
                  >
                    {copied === `act-${a.action}` ? <CheckCheck size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}

// ── Components ────────────────────────────────────────────────

function BigCopyCard({
  icon: Icon,
  accent,
  title,
  desc,
  buttonLabel,
  copied,
  onCopy,
}: {
  icon: typeof Brain;
  accent: "primary" | "purple";
  title: string;
  desc: string;
  buttonLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const accentClass = accent === "primary" ? "from-primary/30 to-primary/5 border-primary/40" : "from-purple/30 to-purple/5 border-purple/40";
  const btnClass =
    accent === "primary"
      ? "bg-primary text-black hover:bg-primary/90 shadow-glow"
      : "bg-purple text-white hover:bg-purple/90 shadow-[0_0_24px_rgba(168,85,247,0.45)]";

  return (
    <div className={`glass p-6 flex flex-col gap-4 bg-gradient-to-br ${accentClass} border-2`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent === "primary" ? "bg-primary/20" : "bg-purple/20"}`}>
          <Icon size={22} strokeWidth={2.3} className={accent === "primary" ? "text-primary" : "text-purple"} />
        </div>
        <div className="font-display text-lg tracking-wide text-white font-bold">{title}</div>
      </div>
      <p className="text-sm text-white/85 leading-relaxed font-medium">{desc}</p>
      <button
        onClick={onCopy}
        className={`mt-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-display tracking-widest text-sm uppercase font-black transition ${btnClass}`}
      >
        {copied ? <CheckCheck size={16} strokeWidth={3} /> : <Copy size={16} strokeWidth={2.8} />}
        {buttonLabel}
      </button>
    </div>
  );
}

function CredentialCard({
  label,
  value,
  realValue,
  icon: Icon,
  hint,
  show,
  onToggleShow,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  realValue?: string;
  icon: typeof KeyRound;
  hint: string;
  show?: boolean;
  onToggleShow?: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <GlassCard>
      <div className="flex items-center gap-2 font-display text-xs tracking-widest text-white/80 font-bold uppercase mb-3">
        <Icon size={13} strokeWidth={2.5} className="text-primary" />
        {label}
      </div>
      <div className="flex items-center gap-2 font-mono text-sm bg-black/60 border border-white/[0.08] rounded-lg px-3 py-2.5">
        <span className="flex-1 truncate text-primary font-bold">{value}</span>
        {onToggleShow && (
          <button onClick={onToggleShow} className="text-white/70 hover:text-white shrink-0" title={show ? "Hide" : "Show"}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
        <button onClick={onCopy} className="text-white/70 hover:text-white shrink-0" title="Copy">
          {copied ? <CheckCheck size={15} className="text-success" /> : <Copy size={15} />}
        </button>
      </div>
      <p className="text-xs text-white/70 mt-3 font-medium">{hint}</p>
    </GlassCard>
  );
}

function CopyPill({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display font-bold tracking-widest uppercase transition ${
        copied
          ? "bg-success/20 text-success border border-success/40"
          : "bg-white/5 hover:bg-primary/15 text-white/80 hover:text-primary border border-white/10 hover:border-primary/40"
      }`}
    >
      {copied ? <CheckCheck size={13} strokeWidth={3} /> : <Copy size={13} strokeWidth={2.5} />}
      {label}
    </button>
  );
}
