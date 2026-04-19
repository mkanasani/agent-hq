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
const PAGES = "agent-hq-pages";
const SERVICE_CONFIG = "agent-hq-service-config"; // third-party API keys: apify, agentmail, gemini (shared)
const OUTREACH_CAMPAIGNS = "agent-hq-outreach-campaigns";
const OUTREACH_LEADS = "agent-hq-outreach-leads"; // key: `<campaign_id>/<lead_id>`
const OUTREACH_EMAILS = "agent-hq-outreach-emails"; // key: `<campaign_id>/<email_id>`
const OUTREACH_REPLIES = "agent-hq-outreach-replies"; // inbound replies from AgentMail

// Service keys we onboard. `gemini` doubles as the voice key — reads through VOICE_CONFIG for back-compat.
type ServiceKey = "gemini" | "apify" | "agentmail";
const SERVICE_KEYS: ServiceKey[] = ["gemini", "apify", "agentmail"];

type ServiceConfigRecord = { key: string; updated_at: string; last_test?: { ok: boolean; at: string; message?: string } };

// Redact a stored key for display — keep first 4 and last 4 chars so the
// user can visually confirm it's theirs without exposing the full secret.
function maskKey(raw: string): string {
  if (!raw) return "";
  if (raw.length <= 10) return "•".repeat(raw.length);
  return `${raw.slice(0, 4)}${"•".repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`;
}

async function readServiceKey(name: ServiceKey): Promise<string | null> {
  if (name === "gemini") {
    // Back-compat: voice wrote the Gemini key to VOICE_CONFIG first.
    const voice = await readJson<{ gemini_key?: string }>(store(VOICE_CONFIG), "config");
    if (voice?.gemini_key) return voice.gemini_key;
  }
  const rec = await readJson<ServiceConfigRecord>(store(SERVICE_CONFIG), name);
  return rec?.key ?? null;
}

async function writeServiceKey(name: ServiceKey, key: string, test?: ServiceConfigRecord["last_test"]): Promise<void> {
  const rec: ServiceConfigRecord = { key, updated_at: new Date().toISOString(), last_test: test };
  await writeJson<ServiceConfigRecord>(store(SERVICE_CONFIG), name, rec);
  // Keep voice store in sync when the gemini key is set, so voice.config.get still works.
  if (name === "gemini") {
    await writeJson(store(VOICE_CONFIG), "config", { gemini_key: key, updated_at: rec.updated_at });
  }
}

// Light-touch "does this key actually work" tests. We do NOT hit the full
// service surface here — just a cheap endpoint that returns 200 on a valid
// key and 401/403 on an invalid one. Keeps onboarding fast.
async function testServiceKey(name: ServiceKey, key: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (name === "gemini") {
      // Gemini "models" list is a cheap authenticated GET.
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`,
      );
      if (r.ok) return { ok: true, message: "Gemini key verified" };
      const body = await r.text();
      return { ok: false, message: `Gemini rejected key (${r.status}): ${body.slice(0, 120)}` };
    }
    if (name === "apify") {
      // Apify "user/me" requires a valid token.
      const r = await fetch("https://api.apify.com/v2/users/me", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) return { ok: true, message: "Apify key verified" };
      const body = await r.text();
      return { ok: false, message: `Apify rejected key (${r.status}): ${body.slice(0, 120)}` };
    }
    if (name === "agentmail") {
      // AgentMail "inboxes" list is a cheap authenticated GET.
      const r = await fetch("https://api.agentmail.to/v0/inboxes?limit=1", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (r.ok) return { ok: true, message: "AgentMail key verified" };
      const body = await r.text();
      return { ok: false, message: `AgentMail rejected key (${r.status}): ${body.slice(0, 120)}` };
    }
    return { ok: false, message: `Unknown service: ${name}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}

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

// ── AgentMail helpers ──────────────────────────────────────────────
// Thin fetch wrappers. We don't use the official SDK to keep the function
// bundle small and avoid @agentmail/sdk's surface area surprises.

async function agentmailFetch(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.agentmail.to/v0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

type AgentMailInbox = { inbox_id: string; email?: string; display_name?: string };

async function getOrCreateCampaignInbox(key: string, campaignName: string): Promise<AgentMailInbox> {
  // Try to list inboxes first — if we have one already, reuse it. Most
  // attendees will only ever have one default inbox on free tier. We pick
  // the first one. If none exists, create a default.
  const listR = await agentmailFetch(key, "/inboxes?limit=10");
  if (listR.ok) {
    const body = (await listR.json()) as { inboxes?: AgentMailInbox[] };
    if (body.inboxes && body.inboxes.length > 0) return body.inboxes[0];
  }
  // Create a new inbox. AgentMail picks a username if we don't.
  const createR = await agentmailFetch(key, "/inboxes", {
    method: "POST",
    body: JSON.stringify({ display_name: campaignName.slice(0, 80) }),
  });
  if (!createR.ok) {
    const txt = await createR.text();
    throw new Error(`AgentMail inbox create failed (${createR.status}): ${txt.slice(0, 200)}`);
  }
  return (await createR.json()) as AgentMailInbox;
}

// Rewrite every <a href="..."> in the HTML body to route through the
// AgentHQ click tracker. The tracker function lives at /t/<token> and
// 302s to the original URL after logging the click.
function rewriteLinksForTracking(html: string, baseUrl: string, campaignId: string, leadId: string, emailId: string): string {
  return html.replace(/href="([^"]+)"/gi, (full, rawUrl) => {
    if (!rawUrl || typeof rawUrl !== "string") return full;
    // Skip anchor-only, mailto:, tel:, and already-tracked links.
    if (/^(#|mailto:|tel:|sms:)/i.test(rawUrl)) return full;
    if (rawUrl.startsWith(`${baseUrl}/t/`)) return full;
    const payload = { c: campaignId, l: leadId, e: emailId, u: rawUrl };
    const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `href="${baseUrl}/t/${token}"`;
  });
}

// ── Gemini email drafting ─────────────────────────────────────────────

const DRAFT_SYSTEM_PROMPT = `You write short, high-reply-rate cold outreach emails. Rules:
- 70–120 words. Short subject (5–8 words, no emoji).
- One clear observation about the recipient's business from the data provided.
- One specific value hook tied to the sender's context.
- One low-friction ask (question or 15-min call).
- No fluff, no "I hope this finds you well", no superlatives, no fake flattery.
- Conversational and personal, not corporate — but use STANDARD sentence capitalization. Proper nouns (person names, company names, cities, products, brands) are ALWAYS capitalized. Never lowercase "I", never lowercase a person's name or company name. Sentences start with a capital letter.
- Greeting: if the recipient's first name can be inferred, use "Hi <First Name>,". Otherwise use "Hi there,". Never "Hi team," for a one-to-one email.
- Do NOT fabricate statistics, client counts, case studies, or specific numbers that weren't given in the sender context. No "We've helped 50+ clients" unless that exact number was provided.
- Sign the email with the sender's name and company exactly as provided — keep their original capitalization.
- Output ONLY JSON: { "subject": "...", "body_text": "...", "body_html": "<p>...</p>" }.
- body_html = plain paragraphs with <p> tags only. No inline styles.`;

type EmailDraft = { subject: string; body_text: string; body_html: string };

async function generateEmailDraft(
  geminiKey: string,
  lead: { name?: string; company?: string; website?: string; category?: string; address?: string; notes?: string },
  senderContext: { sender_name?: string; sender_company?: string; sender_offer?: string; campaign_query?: string },
): Promise<EmailDraft> {
  const leadSummary = [
    lead.name ? `Business: ${lead.name}` : null,
    lead.company && lead.company !== lead.name ? `Company: ${lead.company}` : null,
    lead.category ? `Category: ${lead.category}` : null,
    lead.address ? `Location: ${lead.address}` : null,
    lead.website ? `Website: ${lead.website}` : null,
    lead.notes ? `Notes: ${lead.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const senderSummary = [
    senderContext.sender_name ? `Sender name: ${senderContext.sender_name}` : null,
    senderContext.sender_company ? `Sender company: ${senderContext.sender_company}` : null,
    senderContext.sender_offer ? `Offer / value: ${senderContext.sender_offer}` : null,
    senderContext.campaign_query ? `ICP context: ${senderContext.campaign_query}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    systemInstruction: { role: "system", parts: [{ text: DRAFT_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `RECIPIENT\n${leadSummary || "(no data)"}\n\nSENDER\n${senderSummary || "(no context)"}` }],
      },
    ],
    generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini draft failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty draft");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(stripped);
  }
  const obj = parsed as Partial<EmailDraft>;
  return {
    subject: String(obj.subject ?? "").trim() || "Quick question",
    body_text: String(obj.body_text ?? "").trim(),
    body_html: String(obj.body_html ?? "").trim(),
  };
}

// ── Apify helpers ─────────────────────────────────────────────────────

type ApifyLead = {
  title?: string;
  subTitle?: string;
  category?: string;
  categoryName?: string;
  address?: string;
  neighborhood?: string;
  street?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  phone?: string;
  phoneUnformatted?: string;
  website?: string;
  url?: string;
  emails?: string[];
  totalScore?: number;
  reviewsCount?: number;
  placeId?: string;
  // We pass through whatever Apify gives us; this type only documents the
  // fields we actually read.
};

// Apify scrapes typically take 30s–3min. Netlify's synchronous function
// cap is ~26s, so we can't block on run-sync-get-dataset-items. Instead:
// start the actor asynchronously, persist the run id, and let the client
// call outreach.campaign.sync on a short poll loop to finalize once the
// run reaches SUCCEEDED.

async function startApifyGoogleMapsRun(
  apifyKey: string,
  searchTerms: string[],
  location: string,
  maxResults: number,
): Promise<{ runId: string; defaultDatasetId: string | null; status: string }> {
  const input = {
    searchStringsArray: searchTerms,
    locationQuery: location,
    maxCrawledPlacesPerSearch: Math.max(5, Math.min(200, Math.ceil(maxResults / Math.max(1, searchTerms.length)))),
    language: "en",
    scrapePlaceDetailPage: true,
    skipClosedPlaces: true,
    allPlacesNoSearchAction: "",
  };
  const r = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${encodeURIComponent(apifyKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Apify run start failed (${r.status}): ${txt.slice(0, 300)}`);
  }
  const data = (await r.json()) as { data?: { id?: string; defaultDatasetId?: string; status?: string } };
  if (!data.data?.id) throw new Error("Apify did not return a run id");
  return {
    runId: data.data.id,
    defaultDatasetId: data.data.defaultDatasetId ?? null,
    status: data.data.status ?? "READY",
  };
}

async function getApifyRunStatus(
  apifyKey: string,
  runId: string,
): Promise<{ status: string; defaultDatasetId: string | null; statusMessage: string | null }> {
  const r = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apifyKey)}`,
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Apify run fetch failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as { data?: { status?: string; defaultDatasetId?: string; statusMessage?: string } };
  return {
    status: data.data?.status ?? "UNKNOWN",
    defaultDatasetId: data.data?.defaultDatasetId ?? null,
    statusMessage: data.data?.statusMessage ?? null,
  };
}

async function getApifyDatasetItems(
  apifyKey: string,
  datasetId: string,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const r = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(apifyKey)}&clean=true&limit=${limit}`,
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Apify dataset fetch failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  return (await r.json()) as Array<Record<string, unknown>>;
}

// Enrichment — find a contact email by scraping the lead's website.
// Apify's Google Maps actor only rarely returns emails (most businesses
// list phone + website on Google, not email). We fetch a handful of
// well-known contact pages and regex out email addresses. Fails open
// — if no email is found we just return null.
async function findEmailFromWebsite(website: string): Promise<{ email: string | null; tried: string[] }> {
  const tried: string[] = [];
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return { email: null, tried };
  }
  // Only try a handful of paths — keeps each call well under Netlify's
  // 26s cap even when pages are slow.
  const paths = ["", "/contact", "/contact-us"];
  const emailRx = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const mailtoRx = /mailto:([^"'?\s>]+)/gi;
  const found = new Set<string>();

  for (const path of paths) {
    const url = new URL(path, base).toString();
    tried.push(url);
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AgentHQ/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!r.ok) continue;
      const text = await r.text();
      for (const m of text.matchAll(mailtoRx)) {
        if (m[1]) found.add(m[1].toLowerCase().trim().split("?")[0]);
      }
      for (const m of text.matchAll(emailRx)) {
        if (m[0]) found.add(m[0].toLowerCase().trim());
      }
      if (found.size > 0) break; // Stop once we've got a hit.
    } catch {
      continue;
    }
  }

  // Filter obvious junk + image filenames that matched the email regex.
  const cleaned = [...found].filter((e) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)) return false;
    if (/\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(e)) return false;
    if (/^(example|sentry|wixpress|wix|youremail|test)@/i.test(e)) return false;
    if (/\.(example|wixsite|sentry)\./i.test(e)) return false;
    return true;
  });
  if (cleaned.length === 0) return { email: null, tried };

  // Prefer role-based business addresses over individual ones.
  const preferred = cleaned.find((e) => /^(info|contact|hello|hi|admin|sales|office|reception|enquiries|inquiries|support)@/i.test(e));
  return { email: preferred ?? cleaned[0], tried };
}

function extractLeadFromApify(raw: Record<string, unknown>): {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  reviews_count: number | null;
  maps_url: string | null;
} {
  const r = raw as ApifyLead;
  const emails = Array.isArray(r.emails) ? r.emails.filter((e) => typeof e === "string" && e.includes("@")) : [];
  return {
    name: String(r.title ?? r.subTitle ?? "Unknown"),
    email: emails[0] ?? null,
    phone: (r.phone as string | undefined) ?? (r.phoneUnformatted as string | undefined) ?? null,
    website: (r.website as string | undefined) ?? null,
    address: (r.address as string | undefined) ?? null,
    category: (r.categoryName as string | undefined) ?? (r.category as string | undefined) ?? null,
    rating: typeof r.totalScore === "number" ? r.totalScore : null,
    reviews_count: typeof r.reviewsCount === "number" ? r.reviewsCount : null,
    maps_url: (r.url as string | undefined) ?? null,
  };
}

// ── OUTREACH helpers ───────────────────────────────────────────────
// Turns a free-text ICP description into a structured query the Apify
// Google Maps scraper can run. We ask Gemini for JSON only, validate the
// shape, and fall back to a single literal search term if parsing fails
// (so the preview always returns *something* usable).

type StructuredQuery = { location: string; searchTerms: string[]; maxResults: number };

const PREVIEW_SYSTEM_PROMPT = `You convert a natural-language ICP description into a structured Google Maps search plan.

Output ONLY a JSON object with this exact shape — no prose, no markdown, no code fences:
{ "location": "<city, state/country>", "searchTerms": ["<term 1>", "<term 2>", ...], "maxResults": <int> }

Rules:
- "location" = the geographic target the user described. If multiple cities, pick the primary one. If the user named a region/metro, pick a representative anchor city (e.g. "San Francisco Bay Area" -> "San Francisco, CA").
- "searchTerms" = 1–5 distinct business-type queries. Each should be a short phrase a human would type into Google Maps. DO NOT append the location to the search term — that's the "location" field's job. Expand synonyms the user implied (e.g. "law firms" -> "personal injury lawyer", "family lawyer" if context warrants).
- "maxResults" = clamp the user-requested number into [10, 200]. If unspecified, use 50.
- Always return valid JSON. No trailing commas. Double-quoted strings only.`;

async function previewIcpWithGemini(geminiKey: string, userQuery: string, maxResultsHint?: number): Promise<StructuredQuery> {
  const body = {
    systemInstruction: { role: "system", parts: [{ text: PREVIEW_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `ICP description:\n${userQuery}\n\nMax results hint: ${
              typeof maxResultsHint === "number" ? maxResultsHint : "unspecified"
            }`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Gemini preview failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  const data = (await r.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Sometimes the model wraps in ```json fences despite the mime type —
    // strip them and retry.
    const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(stripped);
  }
  const obj = parsed as Partial<StructuredQuery>;
  const location = typeof obj.location === "string" && obj.location.trim() ? obj.location.trim() : "Unknown";
  const terms = Array.isArray(obj.searchTerms) ? obj.searchTerms.filter((t) => typeof t === "string" && t.trim()) : [];
  const searchTerms = terms.length > 0 ? terms.map((t) => (t as string).trim()).slice(0, 5) : [userQuery.slice(0, 80)];
  const rawMax = typeof obj.maxResults === "number" ? obj.maxResults : maxResultsHint ?? 50;
  const maxResults = Math.max(10, Math.min(200, Math.round(rawMax)));
  return { location, searchTerms, maxResults };
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

      // ── SERVICE CONFIG (gemini / apify / agentmail) ───────────────
      // Used by the Onboarding wizard and /settings page. Each service
      // is tested against its own auth endpoint before we save, so by
      // the time the wizard dismisses all three keys are known-good.
      case "config.status": {
        // Returns which keys are set + a masked preview. Never returns raw keys.
        const out: Record<string, { configured: boolean; masked: string | null; updated_at?: string; last_test?: ServiceConfigRecord["last_test"] }> = {};
        for (const name of SERVICE_KEYS) {
          const key = await readServiceKey(name);
          const rec = await readJson<ServiceConfigRecord>(store(SERVICE_CONFIG), name);
          out[name] = {
            configured: !!key,
            masked: key ? maskKey(key) : null,
            updated_at: rec?.updated_at,
            last_test: rec?.last_test,
          };
        }
        return ok(out);
      }
      case "config.set": {
        const { service, key, skip_test = false } = params as Record<string, unknown>;
        if (!service || !SERVICE_KEYS.includes(service as ServiceKey)) {
          return fail(400, `service must be one of: ${SERVICE_KEYS.join(", ")}`);
        }
        if (typeof key !== "string" || !key.trim()) return fail(400, "key required");
        const trimmed = key.trim();
        let test: ServiceConfigRecord["last_test"] | undefined;
        if (!skip_test) {
          const result = await testServiceKey(service as ServiceKey, trimmed);
          test = { ok: result.ok, at: new Date().toISOString(), message: result.message };
          if (!result.ok) {
            // Store nothing on test failure — surface the rejection to the caller.
            return fail(400, result.message);
          }
        }
        await writeServiceKey(service as ServiceKey, trimmed, test);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "system",
          summary: `${service} API key configured`,
        });
        return ok({ configured: true, test });
      }
      case "config.test": {
        // Re-run the validity test for an already-stored key.
        const { service } = params as Record<string, unknown>;
        if (!service || !SERVICE_KEYS.includes(service as ServiceKey)) {
          return fail(400, `service must be one of: ${SERVICE_KEYS.join(", ")}`);
        }
        const key = await readServiceKey(service as ServiceKey);
        if (!key) return fail(404, `${service} key not configured`);
        const result = await testServiceKey(service as ServiceKey, key);
        const rec: ServiceConfigRecord = {
          key,
          updated_at: (await readJson<ServiceConfigRecord>(store(SERVICE_CONFIG), service as string))?.updated_at ?? new Date().toISOString(),
          last_test: { ok: result.ok, at: new Date().toISOString(), message: result.message },
        };
        await writeJson(store(SERVICE_CONFIG), service as string, rec);
        return ok(rec.last_test);
      }
      case "config.clear": {
        const { service } = params as Record<string, unknown>;
        if (!service || !SERVICE_KEYS.includes(service as ServiceKey)) {
          return fail(400, `service must be one of: ${SERVICE_KEYS.join(", ")}`);
        }
        await store(SERVICE_CONFIG).delete(service as string);
        if (service === "gemini") await store(VOICE_CONFIG).delete("config");
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

      // ── PAGES (agent-generated landing pages served at /p/:slug) ──────
      case "page.create": {
        const { slug, title, html_body, theme = "dark-futuristic", linked_form_slug, accent } =
          params as Record<string, string>;
        if (!slug || !title || !html_body) return fail(400, "slug, title, html_body required");
        const normSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        if (!normSlug) return fail(400, "slug resolved to empty after normalization");
        const page = {
          slug: normSlug,
          title,
          html_body,
          theme,
          linked_form_slug: linked_form_slug ?? null,
          accent: accent ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await writeJson(store(PAGES), normSlug, page);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "content",
          summary: `Landing page "${title}" published at /p/${normSlug}`,
          details: { slug: normSlug, linked_form_slug: linked_form_slug ?? null },
        });
        return ok(page);
      }
      case "page.list": {
        return ok(await listJson(store(PAGES)));
      }
      case "page.get": {
        const { slug } = params as Record<string, string>;
        if (!slug) return fail(400, "slug required");
        const record = await readJson(store(PAGES), slug);
        if (!record) return fail(404, "page not found");
        return ok(record);
      }
      case "page.update": {
        const { slug, ...patch } = params as Record<string, string>;
        if (!slug) return fail(400, "slug required");
        const s = store(PAGES);
        const existing = await readJson<Record<string, unknown>>(s, slug);
        if (!existing) return fail(404, "page not found");
        const updated = { ...existing, ...patch, slug, updated_at: new Date().toISOString() };
        await writeJson(s, slug, updated);
        const changedKeys = Object.keys(patch).filter((k) => k !== "slug");
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "content",
          summary: `Landing page "${existing.title ?? slug}" updated (${changedKeys.join(", ") || "no fields"})`,
          details: { slug, changed: changedKeys },
        });
        return ok(updated);
      }
      case "page.delete": {
        const { slug } = params as Record<string, string>;
        if (!slug) return fail(400, "slug required");
        await store(PAGES).delete(slug);
        return ok({ slug, deleted: true });
      }

      // ── OUTREACH (ICP → leads → emails → replies) ─────────────────
      // Phase 2 scope: natural-language preview via Gemini + campaign CRUD.
      // Phase 3 will wire the Apify run, AgentMail send, and reply ingestion.

      case "outreach.preview": {
        // Turn free-text ICP into { location, searchTerms[], maxResults }.
        // This is cheap and safe to call repeatedly — no side effects.
        const { query, max_results } = params as Record<string, unknown>;
        if (typeof query !== "string" || !query.trim()) return fail(400, "query required");
        const geminiKey = await readServiceKey("gemini");
        if (!geminiKey) return fail(400, "Gemini key not configured — open Settings and add it first.");
        try {
          const structured = await previewIcpWithGemini(
            geminiKey,
            query.trim(),
            typeof max_results === "number" ? max_results : undefined,
          );
          return ok(structured);
        } catch (err) {
          return fail(500, err instanceof Error ? err.message : "Preview failed");
        }
      }

      case "outreach.campaign.create": {
        const { name, query, structured_query, description } = params as Record<string, unknown>;
        if (typeof name !== "string" || !name.trim()) return fail(400, "name required");
        if (typeof query !== "string" || !query.trim()) return fail(400, "query required");
        const id = nanoid(12);
        const now = new Date().toISOString();
        const campaign = {
          id,
          name: name.trim(),
          query: query.trim(),
          description: typeof description === "string" ? description : "",
          structured_query: (structured_query as StructuredQuery) ?? null,
          status: "draft" as const, // draft | searching | ready | sending | completed | failed
          total_leads_found: 0,
          leads_imported: 0,
          emails_generated: 0,
          emails_sent: 0,
          emails_delivered: 0,
          emails_bounced: 0,
          emails_clicked: 0,
          emails_replied: 0,
          created_by: identity?.kind === "agent" ? identity.agent_id : null,
          created_at: now,
          updated_at: now,
        };
        await writeJson(store(OUTREACH_CAMPAIGNS), id, campaign);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "content",
          summary: `Outreach campaign created: "${campaign.name}"`,
          details: { campaign_id: id, query: campaign.query },
        });
        return ok(campaign);
      }

      case "outreach.campaign.list": {
        const all = await listJson<{ created_at: string }>(store(OUTREACH_CAMPAIGNS));
        all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return ok(all);
      }

      case "outreach.campaign.get": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const record = await readJson(store(OUTREACH_CAMPAIGNS), id);
        if (!record) return fail(404, "campaign not found");
        return ok(record);
      }

      case "outreach.campaign.update": {
        const { id, ...patch } = params as Record<string, unknown>;
        if (!id || typeof id !== "string") return fail(400, "id required");
        const s = store(OUTREACH_CAMPAIGNS);
        const existing = await readJson<Record<string, unknown>>(s, id);
        if (!existing) return fail(404, "campaign not found");
        const updated = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
        await writeJson(s, id, updated);
        return ok(updated);
      }

      case "outreach.campaign.delete": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        await store(OUTREACH_CAMPAIGNS).delete(id);
        // Note: we leave leads/emails orphaned on purpose. A cleanup
        // sweeper can GC them later if we want. For now the listing queries
        // by campaign_id prefix, so orphans are invisible.
        return ok({ id, deleted: true });
      }

      case "outreach.campaign.run": {
        // Starts the Apify actor asynchronously and returns immediately.
        // Netlify's ~26s function cap means we can't block on a scrape
        // that typically runs 30s–3min. The client polls
        // outreach.campaign.sync to drive the state transition to "ready".
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(s, id);
        if (!campaign) return fail(404, "campaign not found");
        const structured = campaign.structured_query as StructuredQuery | null;
        if (!structured) return fail(400, "campaign has no structured_query — run preview first");
        const apifyKey = await readServiceKey("apify");
        if (!apifyKey) return fail(400, "Apify key not configured");

        try {
          const run = await startApifyGoogleMapsRun(
            apifyKey,
            structured.searchTerms,
            structured.location,
            structured.maxResults,
          );
          const updated = {
            ...campaign,
            status: "searching" as const,
            apify_run_id: run.runId,
            apify_dataset_id: run.defaultDatasetId,
            apify_status: run.status,
            error_message: null,
            last_run_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          await writeJson(s, id, updated);
          await logActivity({
            agent_id: identity?.kind === "agent" ? identity.agent_id : null,
            category: "research",
            summary: `Apify run started for "${campaign.name}"`,
            details: { campaign_id: id, apify_run_id: run.runId },
          });
          return ok(updated);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Run start failed";
          await writeJson(s, id, {
            ...campaign,
            status: "failed",
            error_message: message,
            updated_at: new Date().toISOString(),
          });
          return fail(500, message);
        }
      }

      case "outreach.campaign.sync": {
        // Called by the UI on its poll loop while a campaign is "searching".
        // Queries Apify for run status, imports leads when SUCCEEDED, marks
        // failed when ABORTED/FAILED/TIMED-OUT. Safe no-op if the campaign
        // isn't currently running.
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(s, id);
        if (!campaign) return fail(404, "campaign not found");
        if (campaign.status !== "searching" || !campaign.apify_run_id) {
          return ok({ status: campaign.status, apify_status: campaign.apify_status ?? null, changed: false });
        }
        const apifyKey = await readServiceKey("apify");
        if (!apifyKey) return fail(400, "Apify key not configured");

        try {
          const runStatus = await getApifyRunStatus(apifyKey, campaign.apify_run_id as string);

          // Terminal states → import or mark failed.
          if (runStatus.status === "SUCCEEDED") {
            const datasetId = runStatus.defaultDatasetId ?? (campaign.apify_dataset_id as string | null);
            if (!datasetId) {
              const msg = "Apify succeeded but no dataset id was returned";
              await writeJson(s, id, { ...campaign, status: "failed", error_message: msg, apify_status: runStatus.status, updated_at: new Date().toISOString() });
              return fail(500, msg);
            }
            const structured = campaign.structured_query as StructuredQuery;
            const items = await getApifyDatasetItems(apifyKey, datasetId, structured.maxResults);
            const leadsStore = store(OUTREACH_LEADS);
            let imported = 0;
            for (const raw of items) {
              const extracted = extractLeadFromApify(raw);
              const leadId = nanoid(10);
              const createdAt = new Date().toISOString();
              await writeJson(leadsStore, `${id}/${createdAt}-${leadId}`, {
                id: leadId,
                campaign_id: id,
                ...extracted,
                raw,
                status: "new",
                is_test: false,
                tags: [],
                created_at: createdAt,
              });
              imported++;
            }
            // Preserve any test leads that were added while scrape was running
            // by adding their count to the imported count.
            const existingLeadsBlobs = await leadsStore.list({ prefix: `${id}/` });
            const totalAfter = existingLeadsBlobs.blobs.length;
            const updated = {
              ...campaign,
              status: "ready" as const,
              apify_status: runStatus.status,
              total_leads_found: items.length,
              leads_imported: totalAfter,
              updated_at: new Date().toISOString(),
            };
            await writeJson(s, id, updated);
            await logActivity({
              agent_id: identity?.kind === "agent" ? identity.agent_id : null,
              category: "research",
              summary: `Apify scrape complete: ${imported} leads imported for "${campaign.name}"`,
              details: { campaign_id: id, imported },
            });
            return ok({ status: "ready", apify_status: runStatus.status, imported, changed: true });
          }

          if (["FAILED", "ABORTED", "TIMED-OUT"].includes(runStatus.status)) {
            const msg = `Apify run ${runStatus.status.toLowerCase()}: ${runStatus.statusMessage ?? "no details"}`;
            const updated = {
              ...campaign,
              status: "failed" as const,
              apify_status: runStatus.status,
              error_message: msg,
              updated_at: new Date().toISOString(),
            };
            await writeJson(s, id, updated);
            return ok({ status: "failed", apify_status: runStatus.status, changed: true });
          }

          // Still running — just surface the current Apify status for the UI.
          if (runStatus.status !== campaign.apify_status) {
            await writeJson(s, id, { ...campaign, apify_status: runStatus.status, updated_at: new Date().toISOString() });
          }
          return ok({ status: "searching", apify_status: runStatus.status, changed: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Sync failed";
          return fail(500, message);
        }
      }

      case "outreach.leads.list": {
        const { campaign_id, limit = 500 } = params as Record<string, unknown>;
        if (typeof campaign_id !== "string" || !campaign_id) return fail(400, "campaign_id required");
        const rows = await listJson<{ created_at?: string }>(
          store(OUTREACH_LEADS),
          `${campaign_id}/`,
        );
        rows.sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
        return ok(rows.slice(0, typeof limit === "number" ? limit : 500));
      }

      case "outreach.leads.count": {
        const { campaign_id } = params as Record<string, string>;
        if (!campaign_id) return fail(400, "campaign_id required");
        const { blobs } = await store(OUTREACH_LEADS).list({ prefix: `${campaign_id}/` });
        return ok({ count: blobs.length });
      }

      case "outreach.leads.add_test": {
        // Self-seed a test lead so the attendee can demo the full send-→-reply
        // loop using their own email. Shows as 🧪 TEST in the UI.
        const { campaign_id, name, email, notes } = params as Record<string, string>;
        if (!campaign_id) return fail(400, "campaign_id required");
        if (!email) return fail(400, "email required");
        const campaign = await readJson<Record<string, unknown>>(store(OUTREACH_CAMPAIGNS), campaign_id);
        if (!campaign) return fail(404, "campaign not found");
        const leadId = nanoid(10);
        const createdAt = new Date().toISOString();
        const lead = {
          id: leadId,
          campaign_id,
          name: name || email.split("@")[0],
          email,
          phone: null,
          website: null,
          address: null,
          category: null,
          rating: null,
          reviews_count: null,
          maps_url: null,
          raw: { source: "test_lead" },
          notes: notes ?? null,
          status: "new",
          is_test: true,
          tags: ["test"],
          created_at: createdAt,
        };
        await writeJson(store(OUTREACH_LEADS), `${campaign_id}/${createdAt}-${leadId}`, lead);
        const updated = {
          ...campaign,
          leads_imported: (campaign.leads_imported as number ?? 0) + 1,
          updated_at: new Date().toISOString(),
        };
        await writeJson(store(OUTREACH_CAMPAIGNS), campaign_id, updated);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "system",
          summary: `Test lead added to campaign "${campaign.name}": ${email}`,
          details: { campaign_id, lead_id: leadId },
        });
        return ok(lead);
      }

      case "outreach.leads.delete": {
        const { campaign_id, lead_id } = params as Record<string, string>;
        if (!campaign_id || !lead_id) return fail(400, "campaign_id and lead_id required");
        const leadsStore = store(OUTREACH_LEADS);
        const { blobs } = await leadsStore.list({ prefix: `${campaign_id}/` });
        for (const b of blobs) {
          const lead = await readJson<{ id: string }>(leadsStore, b.key);
          if (lead?.id === lead_id) {
            await leadsStore.delete(b.key);
            return ok({ deleted: true });
          }
        }
        return fail(404, "lead not found");
      }

      case "outreach.leads.enrich_one": {
        // Scrapes the lead's website looking for a contact email. Runs
        // one lead at a time so the UI can loop + show progress, and
        // so we don't blow Netlify's 26s cap on a big campaign. Per-lead
        // latency is usually 2–5s.
        const { campaign_id, lead_id } = params as Record<string, string>;
        if (!campaign_id || !lead_id) return fail(400, "campaign_id and lead_id required");
        const leadsStore = store(OUTREACH_LEADS);
        const { blobs } = await leadsStore.list({ prefix: `${campaign_id}/` });
        let storeKey: string | null = null;
        let lead: Record<string, unknown> | null = null;
        for (const b of blobs) {
          const row = await readJson<Record<string, unknown>>(leadsStore, b.key);
          if ((row as { id?: string } | null)?.id === lead_id) {
            lead = row;
            storeKey = b.key;
            break;
          }
        }
        if (!lead || !storeKey) return fail(404, "lead not found");
        if (lead.email) return ok({ ...lead, already_had_email: true, enriched: false });
        const website = lead.website as string | undefined;
        if (!website) return ok({ ...lead, enriched: false, reason: "no website to scrape" });

        try {
          const { email, tried } = await findEmailFromWebsite(website);
          if (!email) {
            return ok({ ...lead, enriched: false, tried, reason: "no email found on website" });
          }
          const updated = {
            ...lead,
            email,
            enriched_at: new Date().toISOString(),
            enrichment_source: "website_scrape",
            updated_at: new Date().toISOString(),
          };
          await writeJson(leadsStore, storeKey, updated);
          return ok({ ...updated, enriched: true, tried });
        } catch (err) {
          return fail(500, err instanceof Error ? err.message : "Enrichment failed");
        }
      }

      case "outreach.emails.generate_one": {
        // Drafts exactly one email for one lead. Lets the UI loop through
        // N leads client-side and show a live "Generating X of Y" counter
        // — instead of one slow server-side batch that blows Netlify's
        // 26s cap on >~10 leads. Agents can also call this in a loop with
        // a pause between each for polite pacing.
        const { campaign_id, lead_id, sender_name, sender_company, sender_offer } = params as Record<string, string>;
        if (!campaign_id || !lead_id) return fail(400, "campaign_id and lead_id required");
        const geminiKey = await readServiceKey("gemini");
        if (!geminiKey) return fail(400, "Gemini key not configured");

        const cs = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(cs, campaign_id);
        if (!campaign) return fail(404, "campaign not found");

        // Find the lead (iterate — scale here is in the hundreds).
        const leadsStore = store(OUTREACH_LEADS);
        const { blobs } = await leadsStore.list({ prefix: `${campaign_id}/` });
        let lead: Record<string, unknown> | null = null;
        for (const b of blobs) {
          const row = await readJson<Record<string, unknown>>(leadsStore, b.key);
          if ((row as { id?: string } | null)?.id === lead_id) {
            lead = row;
            break;
          }
        }
        if (!lead) return fail(404, "lead not found");
        if (!lead.email) return fail(400, "lead has no email address — cannot draft");

        // Check if a draft already exists for this lead and short-circuit.
        const es = store(OUTREACH_EMAILS);
        const existingEmails = await listJson<{ id: string; lead_id: string }>(es, `${campaign_id}/`);
        const existing = existingEmails.find((e) => e.lead_id === lead_id);
        if (existing) return ok({ ...existing, skipped: true });

        try {
          const draft = await generateEmailDraft(
            geminiKey,
            {
              name: lead.name as string | undefined,
              company: lead.company as string | undefined,
              website: lead.website as string | undefined,
              category: lead.category as string | undefined,
              address: lead.address as string | undefined,
              notes: lead.notes as string | undefined,
            },
            {
              sender_name: sender_name as string | undefined,
              sender_company: sender_company as string | undefined,
              sender_offer: sender_offer as string | undefined,
              campaign_query: campaign.query as string,
            },
          );
          const emailId = nanoid(12);
          const createdAt = new Date().toISOString();
          const record = {
            id: emailId,
            campaign_id,
            lead_id,
            to_email: lead.email,
            to_name: lead.name,
            subject: draft.subject,
            body_text: draft.body_text,
            body_html: draft.body_html,
            sender_name: sender_name ?? null,
            status: "drafted",
            created_at: createdAt,
            updated_at: createdAt,
          };
          await writeJson(es, `${campaign_id}/${createdAt}-${emailId}`, record);
          // Persist the sender context on the campaign so send can pick
          // it up as the default From display name. Also increments
          // emails_generated — safe race-wise since the UI loop is serial.
          await writeJson(cs, campaign_id, {
            ...campaign,
            default_sender_name: sender_name || (campaign.default_sender_name as string | undefined) || null,
            default_sender_company: sender_company || (campaign.default_sender_company as string | undefined) || null,
            default_sender_offer: sender_offer || (campaign.default_sender_offer as string | undefined) || null,
            emails_generated: (campaign.emails_generated as number ?? 0) + 1,
            updated_at: new Date().toISOString(),
          });
          return ok(record);
        } catch (err) {
          return fail(500, err instanceof Error ? err.message : "Draft failed");
        }
      }

      case "outreach.emails.generate": {
        // Gemini drafts a per-lead email. We write one email record per
        // lead under OUTREACH_EMAILS and bump the campaign's emails_generated.
        const { campaign_id, sender_name, sender_company, sender_offer } = params as Record<string, string>;
        if (!campaign_id) return fail(400, "campaign_id required");
        const geminiKey = await readServiceKey("gemini");
        if (!geminiKey) return fail(400, "Gemini key not configured");
        const cs = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(cs, campaign_id);
        if (!campaign) return fail(404, "campaign not found");
        const leads = await listJson<{ id: string; name: string; email: string | null; company?: string; website?: string; category?: string; address?: string; notes?: string }>(
          store(OUTREACH_LEADS),
          `${campaign_id}/`,
        );
        const sendable = leads.filter((l) => l.email);
        if (sendable.length === 0) return fail(400, "No leads with email addresses yet");

        const es = store(OUTREACH_EMAILS);
        let generated = 0;
        const errors: Array<{ lead_id: string; error: string }> = [];
        for (const lead of sendable) {
          try {
            const draft = await generateEmailDraft(
              geminiKey,
              {
                name: lead.name,
                company: lead.company,
                website: lead.website,
                category: lead.category,
                address: lead.address,
                notes: lead.notes,
              },
              {
                sender_name,
                sender_company,
                sender_offer,
                campaign_query: campaign.query as string,
              },
            );
            const emailId = nanoid(12);
            const createdAt = new Date().toISOString();
            await writeJson(es, `${campaign_id}/${createdAt}-${emailId}`, {
              id: emailId,
              campaign_id,
              lead_id: lead.id,
              to_email: lead.email,
              to_name: lead.name,
              subject: draft.subject,
              body_text: draft.body_text,
              body_html: draft.body_html,
              status: "drafted", // drafted | sent | delivered | bounced | clicked | replied | failed
              created_at: createdAt,
              updated_at: createdAt,
            });
            generated++;
          } catch (err) {
            errors.push({ lead_id: lead.id, error: err instanceof Error ? err.message : "unknown" });
          }
        }

        const updated = {
          ...campaign,
          emails_generated: (campaign.emails_generated as number ?? 0) + generated,
          updated_at: new Date().toISOString(),
        };
        await writeJson(cs, campaign_id, updated);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "content",
          summary: `Drafted ${generated} emails for "${campaign.name}"`,
          details: { campaign_id, generated, errors: errors.length },
        });
        return ok({ generated, errors });
      }

      case "outreach.emails.list": {
        const { campaign_id, limit = 500 } = params as Record<string, unknown>;
        if (typeof campaign_id !== "string") return fail(400, "campaign_id required");
        const rows = await listJson<{ created_at?: string }>(store(OUTREACH_EMAILS), `${campaign_id}/`);
        rows.sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
        return ok(rows.slice(0, typeof limit === "number" ? limit : 500));
      }

      case "outreach.emails.update": {
        // Lets the UI tweak a drafted email (subject/body) before send.
        const { campaign_id, email_id, subject, body_text, body_html } = params as Record<string, string>;
        if (!campaign_id || !email_id) return fail(400, "campaign_id and email_id required");
        const es = store(OUTREACH_EMAILS);
        const { blobs } = await es.list({ prefix: `${campaign_id}/` });
        for (const b of blobs) {
          const row = await readJson<Record<string, unknown>>(es, b.key);
          if (row?.id === email_id) {
            const updated = {
              ...row,
              ...(subject ? { subject } : {}),
              ...(body_text ? { body_text } : {}),
              ...(body_html ? { body_html } : {}),
              updated_at: new Date().toISOString(),
            };
            await writeJson(es, b.key, updated);
            return ok(updated);
          }
        }
        return fail(404, "email not found");
      }

      case "outreach.emails.send": {
        // Sends all drafted emails in a campaign via AgentMail. Rewrites
        // outbound links through the /t/:token tracker first, then records
        // AgentMail's message_id + thread_id for later webhook correlation.
        const { campaign_id, email_ids } = params as Record<string, unknown>;
        if (typeof campaign_id !== "string" || !campaign_id) return fail(400, "campaign_id required");
        const agentmailKey = await readServiceKey("agentmail");
        if (!agentmailKey) return fail(400, "AgentMail key not configured");
        const cs = store(OUTREACH_CAMPAIGNS);
        const campaign = await readJson<Record<string, unknown>>(cs, campaign_id);
        if (!campaign) return fail(404, "campaign not found");

        await writeJson(cs, campaign_id, { ...campaign, status: "sending", updated_at: new Date().toISOString() });

        // Deployment URL lets the click-tracker links resolve back to us.
        const baseUrl = event.headers["x-forwarded-proto"] && event.headers["x-forwarded-host"]
          ? `${event.headers["x-forwarded-proto"]}://${event.headers["x-forwarded-host"]}`
          : (process.env.URL ?? "");

        const inbox = await getOrCreateCampaignInbox(agentmailKey, campaign.name as string);

        // Sender display name — per-email overrides campaign-level.
        // Quotes are stripped to prevent header injection / malformed headers.
        const sanitizeDisplayName = (name: string) => name.replace(/["\r\n]/g, "").trim();
        const campaignSenderName = campaign.default_sender_name as string | undefined;

        const es = store(OUTREACH_EMAILS);
        const allEmails = await listJson<{ id: string; campaign_id: string; lead_id: string; to_email: string; subject: string; body_text: string; body_html: string; status: string; sender_name?: string | null }>(
          es,
          `${campaign_id}/`,
        );
        const selectedIds = Array.isArray(email_ids) ? new Set(email_ids as string[]) : null;
        const toSend = allEmails.filter((e) => e.status === "drafted" && (!selectedIds || selectedIds.has(e.id)));

        let sent = 0;
        const errors: Array<{ email_id: string; error: string }> = [];
        for (const em of toSend) {
          try {
            const trackedHtml = rewriteLinksForTracking(em.body_html || `<p>${em.body_text || ""}</p>`, baseUrl, campaign_id, em.lead_id, em.id);
            const effectiveSender = em.sender_name || campaignSenderName;
            const sendBody: Record<string, unknown> = {
              to: [em.to_email],
              subject: em.subject,
              text: em.body_text,
              html: trackedHtml,
            };
            if (effectiveSender && inbox.email) {
              // RFC 5322 From header format: "Display Name" <address>
              sendBody.headers = {
                From: `"${sanitizeDisplayName(effectiveSender)}" <${inbox.email}>`,
              };
            }
            const r = await agentmailFetch(agentmailKey, `/inboxes/${inbox.inbox_id}/messages/send`, {
              method: "POST",
              body: JSON.stringify(sendBody),
            });
            if (!r.ok) {
              const txt = await r.text();
              errors.push({ email_id: em.id, error: `AgentMail send ${r.status}: ${txt.slice(0, 200)}` });
              continue;
            }
            const resp = (await r.json()) as { message_id?: string; thread_id?: string };
            // Re-read the email row (may have been updated), then mark as sent.
            const { blobs } = await es.list({ prefix: `${campaign_id}/` });
            for (const b of blobs) {
              const row = await readJson<{ id: string }>(es, b.key);
              if (row?.id === em.id) {
                await writeJson(es, b.key, {
                  ...row,
                  status: "sent",
                  agentmail_message_id: resp.message_id ?? null,
                  agentmail_thread_id: resp.thread_id ?? null,
                  agentmail_inbox_id: inbox.inbox_id,
                  sent_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
                break;
              }
            }
            sent++;
          } catch (err) {
            errors.push({ email_id: em.id, error: err instanceof Error ? err.message : "unknown" });
          }
        }

        const updated = {
          ...campaign,
          status: sent > 0 ? "completed" : "failed",
          emails_sent: (campaign.emails_sent as number ?? 0) + sent,
          last_send_at: new Date().toISOString(),
          agentmail_inbox_id: inbox.inbox_id,
          updated_at: new Date().toISOString(),
        };
        await writeJson(cs, campaign_id, updated);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "email",
          summary: `Sent ${sent} of ${toSend.length} emails for "${campaign.name}"`,
          details: { campaign_id, sent, errors: errors.length, inbox: inbox.inbox_id },
        });
        return ok({ sent, total: toSend.length, errors, inbox });
      }

      // ── INBOX (AgentMail inbound replies) ─────────────────────────
      case "outreach.replies.list": {
        const { campaign_id, limit = 200 } = params as Record<string, unknown>;
        const s = store(OUTREACH_REPLIES);
        const prefix = typeof campaign_id === "string" && campaign_id ? `${campaign_id}/` : undefined;
        const rows = await listJson<{ received_at?: string }>(s, prefix);
        rows.sort((a, b) => ((a.received_at ?? "") < (b.received_at ?? "") ? 1 : -1));
        return ok(rows.slice(0, typeof limit === "number" ? limit : 200));
      }

      case "outreach.replies.get": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(OUTREACH_REPLIES);
        const { blobs } = await s.list();
        for (const b of blobs) {
          const rec = await readJson<{ id: string }>(s, b.key);
          if (rec?.id === id) return ok(rec);
        }
        return fail(404, "reply not found");
      }

      case "outreach.replies.convert_to_task": {
        // Sugar action: read a reply, create a kanban task card with the
        // quoted body. Ties the outreach loop back to the Tasks board.
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        const s = store(OUTREACH_REPLIES);
        const { blobs } = await s.list();
        let reply: Record<string, unknown> | null = null;
        for (const b of blobs) {
          const rec = await readJson<Record<string, unknown>>(s, b.key);
          if ((rec as { id?: string } | null)?.id === id) {
            reply = rec;
            break;
          }
        }
        if (!reply) return fail(404, "reply not found");
        const taskId = nanoid(10);
        const now = new Date().toISOString();
        const from = (reply.from as string) ?? "unknown";
        const preview = ((reply.text as string) ?? "").slice(0, 200);
        const task = {
          id: taskId,
          title: `Reply from ${from}`,
          description: `${(reply.subject as string) ?? "(no subject)"}\n\n${preview}\n\nCampaign: ${reply.campaign_id ?? "—"}`,
          status: "needs_input",
          assignee_id: null,
          priority: "medium",
          source: "outreach_reply",
          reply_id: id,
          created_at: now,
          updated_at: now,
        };
        await writeJson(store(TASKS), taskId, task);
        await logActivity({
          agent_id: identity?.kind === "agent" ? identity.agent_id : null,
          category: "decision",
          summary: `Reply from ${from} converted to task`,
          details: { task_id: taskId, reply_id: id },
        });
        return ok(task);
      }

      // ── ANALYTICS ─────────────────────────────────────────────────
      case "outreach.analytics.summary": {
        // Derives counters from the emails store instead of the campaign's
        // cached counters — the cache is race-prone when AgentMail fires
        // sent+delivered webhooks within the same millisecond. Reading
        // from emails gives the race-free source of truth.
        const campaigns = await listJson<{ id: string; name: string; created_at?: string; leads_imported?: number }>(
          store(OUTREACH_CAMPAIGNS),
        );
        const totals = {
          campaigns: campaigns.length,
          leads: 0,
          sent: 0,
          delivered: 0,
          bounced: 0,
          clicked: 0,
          replied: 0,
        };
        const perCampaign: Array<{
          id: string;
          name: string;
          created_at?: string;
          leads_imported?: number;
          emails_sent: number;
          emails_delivered: number;
          emails_bounced: number;
          emails_clicked: number;
          emails_replied: number;
        }> = [];
        for (const c of campaigns) {
          const emails = await listJson<{ status?: string; click_count?: number }>(
            store(OUTREACH_EMAILS),
            `${c.id}/`,
          );
          const sent = emails.filter((e) => e.status && e.status !== "drafted").length;
          const delivered = emails.filter((e) => ["delivered", "clicked", "replied"].includes(e.status ?? "")).length;
          const clicked = emails.filter((e) => e.status === "clicked" || e.status === "replied" || (e.click_count ?? 0) > 0).length;
          const replied = emails.filter((e) => e.status === "replied").length;
          const bounced = emails.filter((e) => ["bounced", "complained", "failed"].includes(e.status ?? "")).length;
          totals.leads += c.leads_imported ?? 0;
          totals.sent += sent;
          totals.delivered += delivered;
          totals.clicked += clicked;
          totals.replied += replied;
          totals.bounced += bounced;
          perCampaign.push({
            id: c.id,
            name: c.name,
            created_at: c.created_at,
            leads_imported: c.leads_imported,
            emails_sent: sent,
            emails_delivered: delivered,
            emails_bounced: bounced,
            emails_clicked: clicked,
            emails_replied: replied,
          });
        }
        perCampaign.sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
        return ok({ totals, campaigns: perCampaign.slice(0, 50) });
      }

      // ── WEBHOOK HEALTH TEST ───────────────────────────────────────
      case "outreach.webhook.test": {
        // The onboarding "Run test" button. Sends a closed-loop email
        // (AgentMail inbox → same AgentMail inbox), then polls for
        // inbound webhook events at the given webhook_id for ~15s. If
        // any arrive, the pipe works.
        const { webhook_id } = params as Record<string, string>;
        if (!webhook_id) return fail(400, "webhook_id required");
        const agentmailKey = await readServiceKey("agentmail");
        if (!agentmailKey) return fail(400, "AgentMail key not configured");

        const inbox = await getOrCreateCampaignInbox(agentmailKey, "AgentHQ Health Check");
        const address = inbox.email ?? null;
        if (!address) return fail(500, "AgentMail returned an inbox without an email field. Check your AgentMail account setup.");

        // Snapshot existing event count so we can tell what's new.
        const { blobs: before } = await store(WEBHOOK_EVENTS).list({ prefix: `${webhook_id}/` });
        const beforeCount = before.length;

        // Send a test email to ourselves. The webhook should fire.
        const sendR = await agentmailFetch(agentmailKey, `/inboxes/${inbox.inbox_id}/messages/send`, {
          method: "POST",
          body: JSON.stringify({
            to: [address],
            subject: "AgentHQ webhook health check",
            text: "This is an automated test from your AgentHQ dashboard. If you see event counters tick on the Webhooks page, your integration is wired correctly.",
            html: "<p>This is an automated test from your AgentHQ dashboard.</p><p>If you see event counters tick on the Webhooks page, your integration is wired correctly.</p>",
          }),
        });
        if (!sendR.ok) {
          const txt = await sendR.text();
          return fail(500, `Test send failed (${sendR.status}): ${txt.slice(0, 200)}`);
        }
        const sendBody = (await sendR.json()) as { message_id?: string };

        // Poll for up to 15s for new events on this webhook.
        const deadline = Date.now() + 15000;
        let newEvents = 0;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const { blobs: after } = await store(WEBHOOK_EVENTS).list({ prefix: `${webhook_id}/` });
          newEvents = Math.max(0, after.length - beforeCount);
          if (newEvents > 0) break;
        }

        return ok({
          ok: newEvents > 0,
          test_message_id: sendBody.message_id ?? null,
          test_address: address,
          new_events: newEvents,
          hint:
            newEvents > 0
              ? `Received ${newEvents} webhook event(s) within 15s — your integration is live.`
              : "No events in 15s. Double-check: (a) the webhook URL is pasted into AgentMail → Settings → Webhooks, (b) all event types are enabled, (c) your AgentMail key has webhook permissions.",
        });
      }

      // ── WEBHOOKS (extended for service tagging) ───────────────────
      // Note: base webhook.create/list/events are defined above. We add
      // a typed creation path here so the UI can tag a webhook as AgentMail.
      case "webhook.create_typed": {
        const { name, description = "", service = "generic" } = params as Record<string, string>;
        if (!name) return fail(400, "name required");
        const id = nanoid(12);
        const w = {
          id,
          name,
          description,
          service, // "generic" | "agentmail"
          event_count: 0,
          created_at: new Date().toISOString(),
        };
        await writeJson(store(WEBHOOKS), id, w);
        return ok(w);
      }
      case "webhook.delete": {
        const { id } = params as Record<string, string>;
        if (!id) return fail(400, "id required");
        await store(WEBHOOKS).delete(id);
        return ok({ id, deleted: true });
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
