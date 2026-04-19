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
        desc: "Publish a landing page at /p/<slug>. html_body can be a FULL HTML document (<!doctype html>...) — served verbatim, you own all styling (Tailwind CDN, fonts, whatever) — OR a body fragment, which gets wrapped in the dark-futuristic theme. Full HTML is recommended for anything real. Embed forms anywhere with {{form:<slug>}}.",
        params: "{ slug, title, html_body, linked_form_slug?, accent? }",
      },
      { action: "page.list", desc: "List all published pages" },
      { action: "page.get", desc: "Get one page's record", params: "{ slug }" },
      {
        action: "page.update",
        desc: "REQUIRED for edits. Replaces page content in place at the same URL. Never re-create with page.create to 'update' — use this. Every update logs an activity entry so the human can verify.",
        params: "{ slug, html_body?, title?, accent?, linked_form_slug? }",
      },
      { action: "page.delete", desc: "Unpublish a page", params: "{ slug }" },
    ],
  },
  {
    group: "Outreach (ICP → leads → emails → replies)",
    items: [
      {
        action: "outreach.preview",
        desc: "Convert a free-text ICP into a structured Google Maps search plan: { location, searchTerms[], maxResults }. No side effects — safe to call repeatedly.",
        params: "{ query, max_results? }",
      },
      {
        action: "outreach.campaign.create",
        desc: "Persist a new campaign. Pass the structured_query you got from preview so the UI shows the plan.",
        params: "{ name, query, structured_query?, description? }",
      },
      { action: "outreach.campaign.list", desc: "All campaigns, newest first." },
      { action: "outreach.campaign.get", desc: "One campaign by id.", params: "{ id }" },
      { action: "outreach.campaign.update", desc: "Patch fields on a campaign (e.g. rename).", params: "{ id, ...patch }" },
      {
        action: "outreach.campaign.run",
        desc: "Starts the Apify Google Maps actor asynchronously and returns immediately. Client polls outreach.campaign.sync to finalize. ALWAYS show the human the structured_query preview and get explicit approval (GATE 1) before calling this — Apify costs real credits.",
        params: "{ id }",
      },
      {
        action: "outreach.campaign.sync",
        desc: "Called on a poll loop while a campaign is 'searching'. Queries Apify's run status. When SUCCEEDED, imports dataset items as leads. When FAILED/ABORTED/TIMED-OUT, marks the campaign failed. Safe no-op if the campaign isn't running.",
        params: "{ id }",
      },
      { action: "outreach.campaign.delete", desc: "Removes a campaign record. Leads and emails become orphaned in storage but invisible to the UI.", params: "{ id }" },
      {
        action: "outreach.leads.list",
        desc: "All leads for a campaign, newest first.",
        params: "{ campaign_id, limit? }",
      },
      { action: "outreach.leads.count", desc: "Cheap count.", params: "{ campaign_id }" },
      {
        action: "outreach.leads.add_test",
        desc: "CRITICAL FOR DEMOS. Seeds a test lead with the user's own email so they can watch send→reply live. Shows as 🧪 TEST in the UI. Always offer this before the first real send in a session.",
        params: "{ campaign_id, email, name?, notes? }",
      },
      {
        action: "outreach.leads.enrich_one",
        desc: "Scrapes the lead's website homepage + /contact + /contact-us for a contact email. Returns the updated lead with email set (or { enriched: false, reason } if none found). Call in a loop for every lead that has a website but no email — Apify's Google Maps scraper rarely returns emails, and this recovers ~40–70%.",
        params: "{ campaign_id, lead_id }",
      },
      { action: "outreach.leads.delete", desc: "Remove one lead.", params: "{ campaign_id, lead_id }" },
      {
        action: "outreach.emails.generate_one",
        desc: "Drafts exactly one email for one lead. PREFERRED for agent use — call this in a loop so you stay well under Netlify's 26s function cap and show live progress. Skips leads that already have drafts. Returns { ..., skipped: true } on duplicate.",
        params: "{ campaign_id, lead_id, sender_name?, sender_company?, sender_offer? }",
      },
      {
        action: "outreach.emails.generate",
        desc: "Batch variant — drafts for every lead that has an email. Can timeout for large campaigns. Prefer generate_one in a loop for >10 leads.",
        params: "{ campaign_id, sender_name?, sender_company?, sender_offer? }",
      },
      { action: "outreach.emails.list", desc: "All drafts/sends for a campaign.", params: "{ campaign_id, limit? }" },
      {
        action: "outreach.emails.update",
        desc: "Edit a single draft before send.",
        params: "{ campaign_id, email_id, subject?, body_text?, body_html? }",
      },
      {
        action: "outreach.emails.send",
        desc: "Fires drafted emails via AgentMail from the user's own inbox. Rewrites every outbound link through /t/:token for click tracking. ALWAYS get explicit human approval (GATE 2) before calling this — these are real emails to real people.",
        params: "{ campaign_id, email_ids? }",
      },
      { action: "outreach.replies.list", desc: "Inbound replies. Filter by campaign id if provided.", params: "{ campaign_id?, limit? }" },
      { action: "outreach.replies.get", desc: "One reply's full content.", params: "{ id }" },
      {
        action: "outreach.replies.convert_to_task",
        desc: "Turns a reply into a kanban card in the Needs Input column. Closes the loop back to /tasks.",
        params: "{ id }",
      },
      { action: "outreach.analytics.summary", desc: "Aggregate totals + per-campaign rows. No params." },
      {
        action: "outreach.webhook.test",
        desc: "End-to-end health check. Sends a closed-loop test email from the user's AgentMail inbox to itself, then polls for inbound events for 15s. Use this if the user reports counters aren't ticking.",
        params: "{ webhook_id }",
      },
    ],
  },
  {
    group: "Service config (third-party keys)",
    items: [
      { action: "config.status", desc: "Which service keys are configured (gemini/apify/agentmail) with masked previews. Never returns raw keys." },
      {
        action: "config.set",
        desc: "Set one service key. Verified against the service's cheapest auth endpoint before storage; rejected with the real error if the service says no.",
        params: "{ service: 'gemini'|'apify'|'agentmail', key, skip_test? }",
      },
      { action: "config.test", desc: "Re-run the validity test on an already-stored key.", params: "{ service }" },
      { action: "config.clear", desc: "Remove a stored key.", params: "{ service }" },
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
                   Publishes a landing page at /p/<slug>.

                   TWO MODES, auto-detected from html_body:

                   - FULL HTML (recommended) — html_body starts with
                     <!doctype html> or <html>. Served verbatim. You bring
                     Tailwind CDN, your own fonts, your own everything.
                     This is what you use for real landing pages.

                   - THEMED — html_body is just a body fragment. AgentHQ
                     wraps it in the dark-futuristic theme. Classes:
                     .hero, .features, .card, .button, .button.ghost,
                     .stat, .eyebrow, .cta-row, footer. Good for fast
                     drafts, not for production work.

                   Embed forms in either mode with {{form:<slug>}}. The
                   form brings its own scoped styles in full-HTML mode.

                   Chain after form.create for one-shot lead capture pages.
  page.list
  page.update      { slug, html_body?, title?, accent?, linked_form_slug? }
                   REQUIRED FOR EDITS. Replaces page content at the same
                   slug/URL. Never re-create with page.create to "update".
                   Every successful update writes an activity-log entry so
                   the human can verify you actually did it.
  page.delete      { slug }

═══════════════════════════════════════════════════════════════
OUTREACH — ICP to leads to sends to tracked replies
═══════════════════════════════════════════════════════════════

THE PAYOFF FEATURE. One natural-language sentence → real leads
scraped from Google Maps → personalised emails → sent from the
user's own AgentMail inbox → delivered/bounced/clicked/replied
all tracked live via webhooks.

TWO HARD APPROVAL GATES — NEVER SKIP:

  GATE 1 — before outreach.campaign.run (Apify costs money).
  GATE 2 — before outreach.emails.send (real emails to real people).

At each gate, activity.log a "decision" entry describing exactly
what the human is about to approve, then stop and wait for go/no-go.

THE FLOW:

  outreach.preview          { query, max_results? }
                            Gemini converts a free-text ICP into
                            { location, searchTerms[], maxResults }.
                            No side effects. Always call this FIRST
                            and show the human the plan before create.

  outreach.campaign.create  { name, query, structured_query?, description? }
                            Persist the campaign. Pass the preview
                            result as structured_query.

  outreach.campaign.list
  outreach.campaign.get     { id }
  outreach.campaign.update  { id, ...patch }

  outreach.campaign.run     { id }
                            [GATE 1 before this]
                            Starts the Apify actor ASYNC. Returns
                            in ~1s. Run takes 30s–3min in the
                            background. Campaign goes to status
                            "searching".

  outreach.campaign.sync    { id }
                            Drives the async run to completion.
                            Safe no-op if not searching. Call on a
                            poll loop (every 4–5s) while status ===
                            "searching". When Apify finishes, this
                            imports the leads and flips status to
                            "ready". If Apify failed, marks failed
                            with the real error message.

  outreach.campaign.delete  { id }

  outreach.leads.list       { campaign_id, limit? }
  outreach.leads.count      { campaign_id }
  outreach.leads.add_test   { campaign_id, email, name?, notes? }
                            CRITICAL FOR DEMOS. Seeds a test lead
                            with the user's own email so they can
                            watch send→reply live. Shows as 🧪 TEST.
                            ALWAYS offer this before the first send
                            in a new session.
  outreach.leads.enrich_one { campaign_id, lead_id }
                            Apify's Google Maps actor rarely returns
                            emails — most businesses list phone +
                            website on Google, not email. This action
                            scrapes the lead's website (homepage +
                            /contact + /contact-us) and regex's out
                            email addresses. Call in a loop over every
                            lead with website-but-no-email AFTER
                            campaign.sync imports them. Recovers
                            ~40–70% of emails. Fails open.
  outreach.leads.delete     { campaign_id, lead_id }

  outreach.emails.generate_one  { campaign_id, lead_id,
                                  sender_name?, sender_company?,
                                  sender_offer? }
                            PREFERRED draft action. One lead per
                            call. Loop through leads client-side
                            so you show live "X of Y" progress and
                            never hit Netlify's 26s cap. Skips
                            duplicates (returns { ..., skipped: true }).

  outreach.emails.generate  { campaign_id, sender_name?,
                              sender_company?, sender_offer? }
                            Batch variant. Only safe for small
                            campaigns (<~10 leads). Prefer _one.

  outreach.emails.list      { campaign_id, limit? }
  outreach.emails.update    { campaign_id, email_id, subject?,
                              body_text?, body_html? }

  outreach.emails.send      { campaign_id, email_ids? }
                            [GATE 2 before this]
                            Sends drafts via AgentMail from the
                            user's inbox. Rewrites every href
                            through /t/:token for click tracking.
                            Omit email_ids to send all drafts in
                            the campaign.

  outreach.replies.list     { campaign_id?, limit? }
  outreach.replies.get      { id }
  outreach.replies.convert_to_task   { id }
                            Creates a kanban card in Needs Input
                            with the reply quoted. Closes the loop.

  outreach.analytics.summary
                            Totals + per-campaign rows.

  outreach.webhook.test     { webhook_id }
                            End-to-end webhook health check. Sends
                            a closed-loop email and polls for events
                            for 15s. Use when counters aren't ticking.

SENDER CONTEXT MATTERS:
The sender_offer field shapes the hook Gemini writes. One specific
sentence with an outcome number > vague corporate fluff. The drafts
are only as good as this input. Examples:
  bad  : "We help businesses with AI."
  good : "We cut dental no-shows 40% with AI SMS reminders. Flat
         $2K/mo, live in 10 days, full handover."

Service config (third-party keys):
  config.status
  config.set       { service: 'gemini'|'apify'|'agentmail', key, skip_test? }
  config.test      { service }
  config.clear     { service }

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
