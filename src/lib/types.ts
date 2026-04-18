export type AgentStatus = "online" | "idle" | "offline" | "error";

export type Agent = {
  id: string;
  name: string;
  sign_in_name: string;
  api_key: string | null;
  role: string;
  emoji: string;
  color: string;
  status: AgentStatus;
  last_heartbeat: string | null;
  created_at: string;
};

export type TaskStatus = "todo" | "doing" | "needs_input" | "canceled" | "done";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee_id: string | null;
  priority: "low" | "medium" | "high";
  created_at: string;
  updated_at: string;
};

export type ActivityCategory =
  | "task"
  | "research"
  | "email"
  | "content"
  | "decision"
  | "error"
  | "system";

export type Activity = {
  id: string;
  agent_id: string | null;
  category: ActivityCategory;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type FormFieldType = "text" | "email" | "textarea" | "tel" | "url" | "number" | "date";

export type FormConfig = {
  slug: string;
  title: string;
  description: string;
  fields: Array<{ name: string; label: string; type: FormFieldType; required: boolean }>;
  created_at: string;
};

export type FormSubmission = {
  id: string;
  form_slug: string;
  data: Record<string, string>;
  received_at: string;
};

export type Webhook = {
  id: string;
  name: string;
  description: string;
  event_count: number;
  created_at: string;
};

export type WebhookEvent = {
  id: string;
  webhook_id: string;
  headers: Record<string, string>;
  body: unknown;
  received_at: string;
};

export type VoiceSessionTranscript = { role: "user" | "agent"; text: string; final: boolean };

export type VoiceSessionToolCall = {
  name: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

export type VoiceSessionRecord = {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  transcripts: VoiceSessionTranscript[];
  tools: VoiceSessionToolCall[];
  invitation_id: string | null;
};

export type Page = {
  slug: string;
  title: string;
  html_body: string;
  theme: string;
  linked_form_slug: string | null;
  accent: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceInvitation = {
  id: string;
  agent_name: string;
  agent_id: string | null;
  reason: string;
  context: string;
  status: "pending" | "accepted" | "dismissed";
  created_at: string;
  accepted_at?: string;
};
