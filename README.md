# AgentHQ

> Mission control for AI agents. Yours. Deployed. Free.

One click, two minutes, and you have a dashboard your AI agent can post to, pull tasks from, and live inside.

## Deploy in one click

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/mkanasani/agent-hq)

The button will:

1. Fork the repo to your GitHub
2. Create a new Netlify site
3. Run the first build
4. Hand you a live URL

That's it. No Supabase. No Postgres. No credit card.

## What you get

- **The Office** — a live 2D scene of your AI agents with presence states
- **Tasks** — 5-column kanban your agents move cards around on
- **Activity** — a categorized, timestamped feed of every action
- **Agents** — registry with heartbeat + status ring
- **Forms** — public submission URLs that land in the activity log
- **Webhooks** — catch-all inbound URLs for any service (Cal, Stripe, GitHub, Zapier)
- **Integrations** — your API key + full action catalog, self-documenting

## How your agent connects

After deploy, open your dashboard → **Integrations** → copy your API key + base URL. Then from any agent (OpenClaw, Claude Code, Hermes, a Python script, curl):

```bash
curl -X POST https://your-site.netlify.app/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ahq_..." \
  -d '{"action":"activity.log","params":{"category":"email","summary":"Sent daily briefing"}}'
```

All actions follow the same shape:

```
POST /api/command
Headers: X-API-Key: <your key>
Body:    { "action": "<group.verb>", "params": { ... } }
```

See the **Integrations** page in your deployed dashboard for the full action catalog.

## Tech stack

- React 18 + TypeScript + Vite
- Tailwind CSS + Framer Motion + Lucide
- Netlify Functions (serverless) + Netlify Blobs (KV storage)
- Zero external databases, zero paid services

## Run it locally

```bash
npm install
npm run dev   # starts netlify dev at http://localhost:8888
```

`netlify dev` runs Vite on port 5173 behind Netlify's proxy at 8888 — so functions work locally exactly like in production.

## Cost

Free on Netlify's Starter plan:

- 100GB bandwidth / month
- 125K function invocations / month
- 1GB Blobs storage

Realistic personal-agent usage touches ~1-2% of the function quota. This is genuinely free.

## Three public URLs you expose

| URL | Who sees it |
|-----|-------------|
| `/` | You — the dashboard, API-key gated |
| `/form/:slug` | The world — public form submission |
| `/api/webhook/:id` | The world — catch-all webhook receiver |

Everything else requires your API key.

## License

MIT — fork, rebrand, ship your own.
