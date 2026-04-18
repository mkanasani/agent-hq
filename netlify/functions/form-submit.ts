import type { Handler } from "@netlify/functions";
import { connectLambda } from "@netlify/blobs";
import { nanoid } from "nanoid";
import { store, readJson, writeJson } from "./lib/blobs";

const FORMS = "agent-hq-forms";
const SUBMISSIONS = "agent-hq-submissions";
const ACTIVITY = "agent-hq-activity";

export const handler: Handler = async (event) => {
  connectLambda(event);
  // URL shape: /api/form/:slug  →  function receives /:slug via splat
  const slug = (event.path.split("/").pop() ?? "").trim();
  if (!slug) return { statusCode: 400, body: "Missing form slug" };

  if (event.httpMethod === "GET") {
    const config = await readJson(store(FORMS), slug);
    if (!config) return { statusCode: 404, body: "Form not found" };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    };
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  const config = await readJson(store(FORMS), slug);
  if (!config) return { statusCode: 404, body: "Form not found" };

  let data: Record<string, string> = {};
  try {
    data = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const id = nanoid(12);
  const received_at = new Date().toISOString();
  const submission = { id, form_slug: slug, data, received_at };
  await writeJson(store(SUBMISSIONS), `${slug}/${received_at}-${id}`, submission);

  const activityId = nanoid(12);
  await writeJson(store(ACTIVITY), `${received_at}-${activityId}`, {
    id: activityId,
    agent_id: null,
    category: "system",
    summary: `Form "${slug}" received a submission`,
    details: { submission_id: id, data },
    created_at: received_at,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, submission_id: id }),
  };
};
