# mission-control-forms

**Trigger:** "create a form for …", "collect feedback on …",
"make a signup for …", "build an intake form for …", or any request
to capture structured data from a human via a public URL.

**What it does:** Publishes a public form at `/form/<slug>` in the
user's AgentHQ deployment. Submissions land in the dashboard and
fire activity-log entries the human can review. Forms can also be
embedded into landing pages with a `{{form:<slug>}}` marker.

**Replaces:** Typeform (from $25/mo), Tally ($29/mo), Jotform ($39/mo),
Google Forms (free but ugly and not agent-friendly).

---

## Setup — one-time

In your agent config:

```
AGENT_HQ_URL=<e.g. https://agent-hq.netlify.app>
AGENT_HQ_KEY=<your master or agent api_key>
```

Every call is the same shape:

```
POST {AGENT_HQ_URL}/api/command
Headers:
  Content-Type: application/json
  X-API-Key: {AGENT_HQ_KEY}
Body:
  {"action": "<group.verb>", "params": { ... }}
```

---

## The core flow

```bash
# Create a form
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"form.create",
    "params":{
      "slug":"acme-demo-request",
      "title":"Request a demo",
      "description":"15 minutes. No pitch deck.",
      "fields":[
        {"name":"full_name","label":"Your name","type":"text","required":true},
        {"name":"work_email","label":"Work email","type":"email","required":true},
        {"name":"company","label":"Company","type":"text","required":true},
        {"name":"team_size","label":"Team size","type":"number","required":false},
        {"name":"notes","label":"What are you hoping to solve?","type":"textarea","required":false}
      ]
    }
  }'
```

The form is immediately live at `{AGENT_HQ_URL}/form/acme-demo-request`.
Share that URL with the human or embed it in a landing page (see below).

---

## Field schema — `fields` objects (READ THIS)

Each entry in `fields` MUST include all four keys:

```json
{
  "name": "full_name",
  "label": "Your name",
  "type": "text",
  "required": true
}
```

- **`name`** — lowercase machine slug, underscores only. This becomes
  the key in every submission, so downstream queries break if you omit
  it. The server will auto-derive it from the label if missing, but
  always set it explicitly so you know what's coming back.
- **`label`** — the human-readable prompt shown above the input.
- **`type`** — one of:
  - `text` — single-line text
  - `email` — email input with validation
  - `textarea` — multi-line text
  - `tel` — phone number
  - `url` — URL with validation
  - `number` — numeric
  - `date` — date picker

  Any other value is coerced to `text`. Don't rely on that.
- **`required`** — boolean.

---

## Reading submissions

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "X-API-Key: $AGENT_HQ_KEY" -H "Content-Type: application/json" \
  -d '{"action":"form.submissions","params":{"slug":"acme-demo-request"}}'
```

Returns an array of submission objects, each with a flat key-value map
matching your field names:

```json
[
  {
    "id": "sub_abc123",
    "slug": "acme-demo-request",
    "submitted_at": "2026-04-19T14:30:00.000Z",
    "data": {
      "full_name": "Jane Cooper",
      "work_email": "jane@acme.com",
      "company": "Acme Corp",
      "team_size": 42,
      "notes": "Looking to automate our SDR pipeline."
    }
  }
]
```

Every submission also writes an activity-log entry so the human sees
new inbound data on the Office page ticker.

---

## Embedding into a landing page

Forms shine when combined with `page.create`. Create the form first,
then reference it by slug in your page HTML:

```bash
# 1. Create the form
curl -X POST $AGENT_HQ_URL/api/command ... \
  -d '{
    "action":"form.create",
    "params":{
      "slug":"atlas-inquiry",
      "title":"Let'"'"'s talk",
      "description":"Tell us a bit. We reply within 24 hours.",
      "fields":[
        {"name":"name","label":"Name","type":"text","required":true},
        {"name":"email","label":"Work email","type":"email","required":true},
        {"name":"scope","label":"What are you working on?","type":"textarea","required":true}
      ]
    }
  }'

# 2. Create the page — drop {{form:atlas-inquiry}} anywhere in HTML
curl -X POST $AGENT_HQ_URL/api/command ... \
  -d '{
    "action":"page.create",
    "params":{
      "slug":"atlas-labs",
      "title":"Atlas Labs",
      "linked_form_slug":"atlas-inquiry",
      "html_body":"<!doctype html><html>...<section>{{form:atlas-inquiry}}</section>...</html>"
    }
  }'
```

The `{{form:<slug>}}` marker is replaced at serve time with a scoped,
styled form that POSTs to `/api/form/<slug>`. In full-HTML page mode
the form brings its own CSS so it won't clash with your design.

---

## Good form patterns

### Demo request / sales inquiry
```json
{
  "fields": [
    {"name":"full_name","label":"Your name","type":"text","required":true},
    {"name":"work_email","label":"Work email","type":"email","required":true},
    {"name":"company","label":"Company","type":"text","required":true},
    {"name":"role","label":"Your role","type":"text","required":false},
    {"name":"team_size","label":"Team size","type":"number","required":false},
    {"name":"timeline","label":"Ideal start date","type":"date","required":false},
    {"name":"scope","label":"What problem are we solving?","type":"textarea","required":true}
  ]
}
```

### Newsletter signup (keep it brutally short)
```json
{
  "fields": [
    {"name":"email","label":"Email","type":"email","required":true},
    {"name":"name","label":"First name","type":"text","required":false}
  ]
}
```

### Event RSVP
```json
{
  "fields": [
    {"name":"full_name","label":"Your name","type":"text","required":true},
    {"name":"email","label":"Email","type":"email","required":true},
    {"name":"attending","label":"Can you make it?","type":"text","required":true},
    {"name":"guests","label":"Number of guests","type":"number","required":false},
    {"name":"dietary","label":"Dietary notes","type":"textarea","required":false}
  ]
}
```

### Feedback form (with rating)
```json
{
  "fields": [
    {"name":"rating","label":"1–10, how was it?","type":"number","required":true},
    {"name":"best_part","label":"What worked?","type":"textarea","required":false},
    {"name":"worst_part","label":"What should we fix?","type":"textarea","required":false},
    {"name":"email","label":"Email (optional, if you want a reply)","type":"email","required":false}
  ]
}
```

---

## Full action catalog

- `form.create` — create a public form at `/form/<slug>`. Idempotent
  on slug — calling again with the same slug updates the form's title,
  description, and fields in place. Existing submissions are preserved.
  params: `{ slug, title, description?, fields: [{ name, label, type, required }] }`
- `form.list` — list all forms in the deployment.
- `form.submissions` — list submissions for one form, newest first.
  params: `{ slug }`

---

## Slug rules

- lowercase alphanumeric + hyphens
- max 48 characters
- must be unique per deployment (re-creating the same slug overwrites
  the form config)

Good: `demo-request`, `q2-newsletter`, `acme-event-rsvp`
Bad: `Demo Request`, `demo_request_form!`, `/forms/demo`

---

## Design principle

Forms should feel invisible — never more than 5 fields for a top-of-
funnel ask, never more than 10 for a high-intent one. The human
interacting with the form shouldn't care that an agent built it.
Short labels, obvious required fields, one clear call-to-action at
the bottom.

If you find yourself adding a 6th field, ask: **can I infer this from
what I already have, or does the human really need to type it?**
