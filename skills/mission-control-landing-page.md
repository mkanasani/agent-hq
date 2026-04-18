# mission-control-landing-page

**Trigger:** "build me a landing page for …" or "create a page with …" or "ship a page …"

**What it does:** Generates a complete, professional-looking landing page on the
user's AgentHQ deployment — with an optional contact form embedded inline — and
returns a live URL in under 30 seconds. The AgentHQ theme wrapper handles
typography, layout, glow, and dark-mode aesthetics automatically. You write the
semantic HTML body; the theme makes it beautiful.

**Replaces:** Webflow ($14-39/mo), Carrd ($19/yr), Framer ($15-30/mo), a
freelance landing-page designer ($500-$5,000 one-time).

---

## Setup — one-time

In your agent config:

```
AGENT_HQ_URL=<e.g. https://agent-hq.netlify.app>
AGENT_HQ_KEY=<your master or agent api_key>
```

---

## Execution steps

### STEP 1 — Listen carefully to the brief

Before you write any HTML, identify:

- **Who the page is for** (business owner? freelancer? AI agency? photographer?
  student portfolio?)
- **What the page should do** (capture leads? showcase work? explain a service?
  sell a product?)
- **Does the user want a contact form?** If yes, plan to create it first.
- **What tone / vibe?** (minimal, bold, futuristic, editorial, playful)

If any of these are unclear, ASK the user before you build. One clarifying
question is worth ten regenerations.

### STEP 2 — (Optional) Create the contact form first

If the page needs a contact form, chain `form.create` before the page. This is
what makes this skill magical — one prompt produces a working lead capture.

Choose a form slug that matches the page (e.g. `portfolio-inquiry` for
`portfolio-jane-smith`).

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"form.create",
    "params":{
      "slug":"portfolio-inquiry",
      "title":"Let\"'"'"'"s talk",
      "description":"Drop your project details and I\"'"'"'"ll get back within 24 hours.",
      "fields":[
        {"name":"name","label":"Your Name","type":"text","required":true},
        {"name":"email","label":"Email","type":"email","required":true},
        {"name":"project","label":"What are you building?","type":"textarea","required":true}
      ]
    }
  }'
```

**CRITICAL field shape:** each field needs ALL four keys — `name` (lowercase
slug), `label` (human readable), `type` (text / email / textarea / tel / url /
number / date), and `required` (boolean).

### STEP 3 — Write the HTML body

You're writing the content INSIDE `<main class="ahq-page">`. The theme wrapper
supplies `<html>`, `<head>`, fonts, CSS, and dark futuristic styling. Do NOT
write `<!doctype>`, `<html>`, `<head>`, `<body>`, or inline `<style>` tags.
Your HTML is just the semantic body.

**Class conventions that the theme styles automatically:**

| Element | Class | What it gives you |
|---|---|---|
| Hero section | `<section class="hero">` | Comfortable top padding, left-aligned by default |
| Eyebrow tag | `<span class="eyebrow">BRAND</span>` | Uppercase pill with accent glow |
| Headline | `<h1>` | Huge Orbitron with accent-gradient text |
| Subhead | `<p>` after h1 | Muted Rajdhani, readable line length |
| Features grid | `<section class="features">` wrapping `<div class="card">` children | Auto-responsive grid |
| Glass card | `<div class="card">` | Blurred glass with hover glow |
| Big stat | `<div class="stat">93%</div>` | Oversized gradient number |
| CTA row | `<div class="cta-row">` | Horizontal buttons row |
| Button primary | `<a class="button">` | Solid accent with glow |
| Button ghost | `<a class="button ghost">` | Transparent outline |
| Footer | `<footer>` or `<div class="footer">` | Top border + dim text |

**Structure a landing page in roughly this shape:**

```html
<section class="hero">
  <span class="eyebrow">Eyebrow or brand name</span>
  <h1>Headline that stops the scroll.</h1>
  <p>One-sentence value prop that makes the headline unmistakable.</p>
  <div class="cta-row">
    <a href="#contact" class="button">Primary CTA</a>
    <a href="#features" class="button ghost">Secondary</a>
  </div>
</section>

<section id="features" class="features">
  <div class="card">
    <h3>Benefit one</h3>
    <p>Why it matters in a sentence.</p>
  </div>
  <div class="card">
    <h3>Benefit two</h3>
    <p>The proof point.</p>
  </div>
  <div class="card">
    <h3>Benefit three</h3>
    <p>The differentiator.</p>
  </div>
</section>

<section>
  <h2>Proof / results / testimonials</h2>
  <div class="features">
    <div class="card">
      <div class="stat">93%</div>
      <p>Outcome stat with source.</p>
    </div>
    <div class="card">
      <p>"Short testimonial quote that lands."</p>
      <p><strong>— Name, Title</strong></p>
    </div>
  </div>
</section>

{{form:portfolio-inquiry}}

<footer>
  <p>© Your Name — Built in 30 seconds on AgentHQ.</p>
</footer>
```

**The `{{form:slug}}` marker** — this is how you embed a form inline. The
theme server replaces it with a styled form that POSTs to
`/api/form/<slug>`. No JavaScript required from you. Just the marker.

### STEP 4 — Publish the page

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"page.create",
    "params":{
      "slug":"portfolio-jane-smith",
      "title":"Jane Smith — Product Design",
      "linked_form_slug":"portfolio-inquiry",
      "accent":"#00BFFF",
      "html_body":"<section class=\"hero\">...your HTML here...</section>"
    }
  }'
```

**Parameters:**

- `slug` — lowercase, dashes only. Becomes the URL path at `/p/<slug>`.
- `title` — appears in the browser tab.
- `html_body` — your semantic HTML. Escape quotes and newlines if sending via
  JSON. Long HTML is fine.
- `linked_form_slug` *(optional)* — if set, the embedded form posts to this
  form's endpoint. Usually matches a form you created in STEP 2.
- `accent` *(optional)* — hex color for headings, buttons, and glow. Default
  `#00BFFF`. Match the user's brand if they gave you one.

### STEP 5 — Return the live URL

The response includes `created_at` and the normalized slug. Construct the URL
and tell the user:

```
Your page is live at:
https://<their-site>.netlify.app/p/<slug>

Contact form submissions will appear in your Forms tab and trigger activity
log entries. Open the page in a new tab to see it.
```

Log the activity so the dashboard shows what you did:

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"activity.log",
    "params":{
      "category":"content",
      "summary":"Published landing page: <title>",
      "details":{"slug":"<slug>","url":"<full url>"}
    }
  }'
```

---

## Iteration — when the user wants changes

Treat the first page as a draft. The user will say things like:

- *"Make the headline more aggressive."*
- *"Add a testimonials section with three quotes."*
- *"Change the accent to orange."*
- *"Remove the features grid, replace with a pricing table."*

To iterate: regenerate the full HTML body with the requested change, then call
`page.update` with the same slug. The page is replaced at the same URL.

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"page.update",
    "params":{
      "slug":"portfolio-jane-smith",
      "html_body":"<section class=\"hero\">...new HTML...</section>",
      "accent":"#FF6B35"
    }
  }'
```

Same URL, updated content. The user refreshes — they see the new version.

---

## Design vocabulary — the look that makes people screenshot

The theme wrapper ships a **dark-futuristic glassmorphic** design system. You
don't import fonts, write CSS, or design anything. You write HTML that uses
the vocabulary below, and the output looks like a $5K brand site.

### Glassmorphism (already on every `.card`)

Every element with class `.card` gets:

- Semi-transparent background (`rgba(255,255,255,0.02)`)
- 20px backdrop blur so the radial-gradient background bleeds through
- 1px border at 8% white
- Inset top highlight (1px line of subtle light)
- 16px rounded corners

Stack cards in a `.features` grid, overlap them on a hero, or use single
large cards for pull-quotes and proof sections — the glass effect reads
beautifully at any size.

### Glow (reserved for what matters)

Three glow patterns ship in the theme:

- **Button glow** — `.button` has a permanent accent-color glow. Use it for
  the primary CTA. Never put glow on more than one button per section.
- **Card hover glow** — `.card:hover` lifts 2px and gains a 24px accent
  glow. Automatic. Don't add your own.
- **Accent pill** — `.eyebrow` is a pill with inset accent-soft background
  and an accent-tinted border. Use it once above an `<h1>`.

If you want a **custom glow** on a one-off element, inline a style:

```html
<div class="card" style="box-shadow: 0 0 48px rgba(168,85,247,0.25);">
  <h3>One-off glow</h3>
  <p>Use sparingly. Glow is a punctuation mark, not a font.</p>
</div>
```

### Hover animations (baked in)

- `.card:hover` — `transform: translateY(-2px)` + border brightens + accent glow appears
- `.button:hover` — lift 1px + glow intensifies
- `a:hover` — underline reveal

Do not add more hover animations. Consistency is what makes it feel
premium; every hover behaving the same is intentional.

### Motion (optional inline additions)

For hero elements you want to animate in, add inline keyframes:

```html
<style>
  .hero-fade { opacity: 0; animation: fade-up 800ms ease-out forwards; }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
<section class="hero hero-fade">
  <span class="eyebrow">Brand</span>
  <h1>Your headline.</h1>
</section>
```

**Rule:** animate at most one element per scroll. Too much motion on a
landing page feels cheap.

### Gradient headline accents (optional)

`<h1>` already has a gradient from white to the accent color — baked in.

For secondary headings that need to pop, use this inline:

```html
<h2 style="background: linear-gradient(135deg, var(--ahq-accent), var(--ahq-purple)); -webkit-background-clip: text; background-clip: text; color: transparent;">
  Secondary headline that glows
</h2>
```

### Large stat blocks (high-conversion copy)

The `.stat` class renders an oversized gradient number (3-5rem).

```html
<div class="card">
  <div class="stat">93%</div>
  <p>Of our clients renew annually. Source: internal 2025.</p>
</div>
```

Use for proof. One `.stat` per section. Never more than three on a page.

### Typography stack (already loaded)

- **Orbitron** (headings) — geometric, futuristic, 700-900 weight
- **Rajdhani** (body) — condensed sans-serif, 500 weight default
- **JetBrains Mono** (code) — auto-applied to `<code>` and `<pre>`

You don't declare any of these. Just use the semantic tag.

---

## Integration chain — the two-call pattern

This is the core pattern every landing page uses. Memorize it.

### STEP A — Create the form (if the page has a contact form)

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"form.create",
    "params":{
      "slug":"<form-slug>",
      "title":"<form title shown above the fields>",
      "description":"<one line under the title>",
      "fields":[
        {"name":"<slug>","label":"<Label>","type":"<type>","required":<bool>}
      ]
    }
  }'
```

### STEP B — Create the page (embedding the form with the marker)

```bash
curl -X POST $AGENT_HQ_URL/api/command \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $AGENT_HQ_KEY" \
  -d '{
    "action":"page.create",
    "params":{
      "slug":"<page-slug>",
      "title":"<browser tab title>",
      "linked_form_slug":"<same form-slug as step A>",
      "accent":"#<hex>",
      "html_body":"<your semantic HTML with {{form:form-slug}} where you want the form>"
    }
  }'
```

The response includes the page record. The live URL is:

```
<AGENT_HQ_URL>/p/<page-slug>
```

That's the entire integration. Two POSTs. One URL out.

---

## Design principles — don't ship ugly

The theme is already beautiful. Your job is to not get in its way.

1. **Short headlines.** 3-7 words max in `<h1>`. Anything longer breaks on
   mobile.
2. **One idea per section.** Don't stack three heroes. Use `<h2>` to break into
   new sections.
3. **Cards in threes.** Features grid looks cleanest with 3 or 6 cards. Two
   cards look lonely. Four cards wrap oddly on medium screens.
4. **Forms near the bottom.** Put `{{form:slug}}` after proof/benefits, not
   before. Capture once they're convinced.
5. **One `<h1>` per page.** Multiple H1s hurt SEO and visual hierarchy.
6. **Accent color = brand color.** Ask. Default to `#00BFFF`.
7. **No emojis in `<h1>`.** They look great in eyebrows, buttons, and body
   copy; they look childish in the main headline.
8. **Don't invent classes.** Stick to the ones the theme styles. Custom classes
   won't break the page but they won't look like the rest of it either.

---

## Example — full end-to-end flow

**User prompt:** *"Build me a landing page for my freelance photography
business. I shoot weddings and editorial work. I want a contact form that asks
what kind of shoot they're planning."*

**Step 1** — Clarify: *"Quick check — what's the business name and do you have
a brand color preference?"*

**User:** *"Lumina Studio. Deep orange, maybe around #FF6B35."*

**Step 2** — Create form:

```bash
curl -X POST $AGENT_HQ_URL/api/command -H "X-API-Key: $AGENT_HQ_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"form.create","params":{"slug":"lumina-inquiry","title":"Let'"'"'s create","description":"Tell me about your shoot.","fields":[{"name":"name","label":"Your Name","type":"text","required":true},{"name":"email","label":"Email","type":"email","required":true},{"name":"shoot_type","label":"What kind of shoot?","type":"text","required":true},{"name":"date","label":"Approximate date","type":"date","required":false},{"name":"details","label":"Tell me more","type":"textarea","required":false}]}}'
```

**Step 3+4** — Write and publish:

```bash
curl -X POST $AGENT_HQ_URL/api/command -H "X-API-Key: $AGENT_HQ_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action":"page.create",
    "params":{
      "slug":"lumina-studio",
      "title":"Lumina Studio — Photography",
      "linked_form_slug":"lumina-inquiry",
      "accent":"#FF6B35",
      "html_body":"<section class=\"hero\"><span class=\"eyebrow\">Lumina Studio</span><h1>Light, written on film.</h1><p>Wedding and editorial photography in a style that lasts longer than a trend.</p><div class=\"cta-row\"><a href=\"#contact\" class=\"button\">Start a project</a><a href=\"#work\" class=\"button ghost\">See work</a></div></section><section id=\"work\" class=\"features\"><div class=\"card\"><h3>Weddings</h3><p>Full-day documentary coverage with a two-shooter option.</p></div><div class=\"card\"><h3>Editorial</h3><p>Brand shoots, lookbooks, magazine commissions.</p></div><div class=\"card\"><h3>Portraits</h3><p>Clean, timeless headshots for founders and executives.</p></div></section>{{form:lumina-inquiry}}<footer><p>© Lumina Studio</p></footer>"
    }
  }'
```

**Step 5** — Reply to user:

> Done. Lumina Studio is live:
> **https://your-site.netlify.app/p/lumina-studio**
>
> Contact form submissions land in your AgentHQ Forms tab under
> `lumina-inquiry`. Tell me if you want the hero darker, more work examples, or
> a pricing section — I can update it in place.

---

## Error handling

- **Slug conflict** — `page.create` will overwrite by default. If you want to
  preserve the old one, append a suffix: `lumina-studio-v2`.
- **Form not found** — if you reference a `{{form:slug}}` that doesn't exist,
  the page renders fine but the section is empty. Always create the form
  first.
- **Bad HTML** — invalid markup still renders but may look odd. Use a quick
  mental scan: opening tags match closing tags, no stray `<div>`s.
- **API returns error** — surface it to the user in plain English. Don't
  retry silently; ask them what to do.
