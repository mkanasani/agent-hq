import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { store, readJson } from "./lib/blobs";

const PAGES = "agent-hq-pages";
const FORMS = "agent-hq-forms";

type Page = {
  slug: string;
  title: string;
  html_body: string;
  theme?: string;
  linked_form_slug?: string | null;
  accent?: string | null;
};

type FormConfig = {
  slug: string;
  title: string;
  description: string;
  fields: Array<{ name: string; label: string; type: string; required: boolean }>;
};

export const handler: Handler = async (event) => {
  connectLambda(event as unknown as Parameters<typeof connectLambda>[0]);

  const slug = (event.path.split("/").pop() ?? "").trim().toLowerCase();
  if (!slug) return htmlResponse(404, notFoundHtml("No slug provided"));

  const page = await readJson<Page>(store(PAGES), slug);
  if (!page) return htmlResponse(404, notFoundHtml(slug));

  let formEmbedHtml = "";
  let inlineFormSlug = page.linked_form_slug ?? null;
  const markerMatch = page.html_body.match(/\{\{form:([a-z0-9-]+)\}\}/i);
  if (markerMatch) inlineFormSlug = markerMatch[1];

  if (inlineFormSlug) {
    const form = await readJson<FormConfig>(store(FORMS), inlineFormSlug);
    if (form) formEmbedHtml = renderInlineForm(form);
  }

  let body = page.html_body;
  if (markerMatch) body = body.replace(markerMatch[0], formEmbedHtml);
  else if (formEmbedHtml) body += formEmbedHtml;

  const html = wrapInTheme(page, body);
  return htmlResponse(200, html);
};

function htmlResponse(status: number, html: string) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
      // Pages change every time an agent calls page.update — never cache.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
    body: html,
  };
}

function renderInlineForm(form: FormConfig): string {
  const fields = form.fields
    .map((f, i) => {
      const name = f.name?.trim() || `field_${i + 1}`;
      const req = f.required ? "required" : "";
      if (f.type === "textarea") {
        return `
      <label class="ahq-field">
        <span>${escapeHtml(f.label)}${f.required ? ' <em class="req">*</em>' : ""}</span>
        <textarea name="${name}" rows="4" ${req}></textarea>
      </label>`;
      }
      return `
      <label class="ahq-field">
        <span>${escapeHtml(f.label)}${f.required ? ' <em class="req">*</em>' : ""}</span>
        <input type="${f.type || "text"}" name="${name}" ${req} />
      </label>`;
    })
    .join("\n");

  return `
<section class="ahq-form-section" id="contact">
  <div class="ahq-form-card">
    <h2>${escapeHtml(form.title)}</h2>
    ${form.description ? `<p class="ahq-form-desc">${escapeHtml(form.description)}</p>` : ""}
    <form class="ahq-form" data-ahq-slug="${form.slug}">
      ${fields}
      <button type="submit" class="ahq-submit">Submit</button>
      <div class="ahq-status" role="status" aria-live="polite"></div>
    </form>
  </div>
</section>
<script>
(function(){
  document.querySelectorAll('form.ahq-form').forEach(function(form){
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      const slug = form.getAttribute('data-ahq-slug');
      const status = form.querySelector('.ahq-status');
      const btn = form.querySelector('.ahq-submit');
      btn.disabled = true;
      status.textContent = 'Sending...';
      const data = {};
      new FormData(form).forEach(function(v, k){ data[k] = v; });
      try {
        const res = await fetch('/api/form/' + slug, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Submit failed (' + res.status + ')');
        form.reset();
        status.className = 'ahq-status success';
        status.textContent = 'Got it. We\\'ll be in touch.';
      } catch (err) {
        status.className = 'ahq-status error';
        status.textContent = 'Something went wrong. Please try again.';
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
</script>`;
}

function wrapInTheme(page: Page, body: string): string {
  const accent = page.accent || "#00BFFF";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
    rel="stylesheet"
  />
  <style>${darkFuturisticCss(accent)}</style>
</head>
<body>
  <main class="ahq-page">${body}</main>
</body>
</html>`;
}

function darkFuturisticCss(accent: string): string {
  return `
:root {
  --ahq-bg: #0a0a0f;
  --ahq-text: rgba(255,255,255,0.96);
  --ahq-muted: rgba(255,255,255,0.72);
  --ahq-dim: rgba(255,255,255,0.5);
  --ahq-border: rgba(255,255,255,0.08);
  --ahq-card: rgba(255,255,255,0.02);
  --ahq-accent: ${accent};
  --ahq-accent-soft: ${accent}22;
  --ahq-accent-glow: ${accent}55;
  --ahq-purple: #A855F7;
  --ahq-success: #00E676;
  --ahq-danger: #FF4D6D;
  --ahq-radius: 16px;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--ahq-bg);
  color: var(--ahq-text);
  font-family: "Rajdhani", system-ui, sans-serif;
  font-weight: 500;
  -webkit-font-smoothing: antialiased;
  scroll-behavior: smooth;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(1200px 800px at 15% 10%, rgba(0,191,255,0.1), transparent 60%),
    radial-gradient(1000px 700px at 85% 90%, rgba(168,85,247,0.1), transparent 60%);
  pointer-events: none;
}
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, black 40%, transparent 80%);
  pointer-events: none;
}
.ahq-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 6rem 1.5rem;
}
h1, h2, h3, h4 {
  font-family: "Orbitron", sans-serif;
  letter-spacing: 0.01em;
  color: var(--ahq-text);
  margin: 0 0 1rem;
  font-weight: 700;
}
h1 {
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  font-weight: 900;
  line-height: 1.05;
  background: linear-gradient(135deg, #fff, ${accent});
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
h2 {
  font-size: clamp(1.75rem, 3.5vw, 2.5rem);
  margin-top: 3rem;
}
h3 { font-size: 1.25rem; }
p {
  color: var(--ahq-muted);
  font-size: 1.05rem;
  line-height: 1.6;
  max-width: 64ch;
  margin: 0 0 1rem;
}
a { color: var(--ahq-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul { color: var(--ahq-muted); padding-left: 1.25rem; }
li { margin-bottom: 0.5rem; }
code, pre { font-family: "JetBrains Mono", monospace; }
hr {
  border: 0;
  height: 1px;
  background: var(--ahq-border);
  margin: 3rem 0;
}
section {
  margin-bottom: 4rem;
}
/* Hero */
.hero, section.hero {
  padding: 3rem 0;
  text-align: left;
}
.hero .eyebrow, .eyebrow {
  display: inline-block;
  font-family: "Orbitron", sans-serif;
  font-size: 0.7rem;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: var(--ahq-accent);
  font-weight: 700;
  margin-bottom: 1.5rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--ahq-accent-glow);
  border-radius: 999px;
  background: var(--ahq-accent-soft);
}
/* Cards grid */
.features, .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1rem;
}
.card {
  background: var(--ahq-card);
  border: 1px solid var(--ahq-border);
  border-radius: var(--ahq-radius);
  padding: 1.5rem;
  backdrop-filter: blur(20px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  transition: border-color 200ms, transform 200ms, box-shadow 200ms;
}
.card:hover {
  border-color: var(--ahq-accent-glow);
  box-shadow: 0 0 24px var(--ahq-accent-glow), inset 0 1px 0 rgba(255,255,255,0.08);
  transform: translateY(-2px);
}
.card h3 { margin-bottom: 0.5rem; }
.card p { font-size: 0.95rem; margin-bottom: 0; }
/* Big stat */
.stat {
  font-family: "Orbitron", sans-serif;
  font-weight: 900;
  font-size: clamp(3rem, 7vw, 5rem);
  line-height: 1;
  background: linear-gradient(135deg, ${accent}, var(--ahq-purple));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
/* Buttons + CTAs */
.button, a.button, button.button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 1.5rem;
  border-radius: var(--ahq-radius);
  background: var(--ahq-accent);
  color: #000;
  font-family: "Orbitron", sans-serif;
  font-weight: 900;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  border: none;
  cursor: pointer;
  box-shadow: 0 0 24px var(--ahq-accent-glow);
  transition: transform 160ms, box-shadow 160ms;
}
.button:hover, a.button:hover, button.button:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 32px var(--ahq-accent-glow);
  text-decoration: none;
}
.button.ghost {
  background: transparent;
  color: var(--ahq-text);
  border: 1px solid var(--ahq-border);
  box-shadow: none;
}
.cta-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1.5rem;
}
/* Footer */
footer, .footer {
  border-top: 1px solid var(--ahq-border);
  padding-top: 2rem;
  margin-top: 5rem;
  color: var(--ahq-dim);
  font-size: 0.85rem;
}
/* Inline form embed */
.ahq-form-section {
  margin-top: 4rem;
}
.ahq-form-card {
  background: var(--ahq-card);
  border: 1px solid var(--ahq-border);
  border-radius: var(--ahq-radius);
  padding: 2rem;
  backdrop-filter: blur(20px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  max-width: 560px;
}
.ahq-form-card h2 { margin-top: 0; font-size: 1.75rem; }
.ahq-form-desc { color: var(--ahq-muted); }
.ahq-form { display: flex; flex-direction: column; gap: 0.9rem; }
.ahq-field { display: flex; flex-direction: column; gap: 0.35rem; }
.ahq-field span {
  font-family: "Orbitron", sans-serif;
  font-size: 0.68rem;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--ahq-muted);
  font-weight: 700;
}
.ahq-field .req { color: var(--ahq-accent); font-style: normal; }
.ahq-field input, .ahq-field textarea {
  background: rgba(0,0,0,0.4);
  border: 1px solid var(--ahq-border);
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
  color: var(--ahq-text);
  font-family: "Rajdhani", sans-serif;
  font-size: 1rem;
  font-weight: 500;
  transition: border-color 160ms, box-shadow 160ms;
}
.ahq-field input:focus, .ahq-field textarea:focus {
  outline: none;
  border-color: var(--ahq-accent-glow);
  box-shadow: 0 0 0 3px var(--ahq-accent-soft);
}
.ahq-submit {
  align-self: flex-start;
  margin-top: 0.5rem;
  padding: 0.85rem 1.5rem;
  border-radius: var(--ahq-radius);
  background: var(--ahq-accent);
  color: #000;
  font-family: "Orbitron", sans-serif;
  font-weight: 900;
  font-size: 0.85rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: none;
  cursor: pointer;
  box-shadow: 0 0 24px var(--ahq-accent-glow);
  transition: transform 160ms, box-shadow 160ms;
}
.ahq-submit:hover { transform: translateY(-1px); box-shadow: 0 0 32px var(--ahq-accent-glow); }
.ahq-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.ahq-status {
  min-height: 1.25rem;
  font-size: 0.9rem;
  color: var(--ahq-muted);
}
.ahq-status.success { color: var(--ahq-success); font-weight: 600; }
.ahq-status.error { color: var(--ahq-danger); font-weight: 600; }
@media (max-width: 640px) {
  .ahq-page { padding: 3rem 1.25rem; }
}
`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFoundHtml(slug: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Page not found</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0}h1{font-weight:200;margin:0 0 1rem}</style>
</head><body><div><h1>Page not found</h1><p>No page at <code>/p/${escapeHtml(slug)}</code></p></div></body></html>`;
}
