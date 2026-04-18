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

export type FormConfig = {
  slug: string;
  title: string;
  description: string;
  fields: Array<{ name: string; label: string; type: "text" | "email" | "textarea"; required: boolean }>;
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
