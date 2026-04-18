import { nanoid } from "nanoid";
import { store, readJson, writeJson } from "./blobs";

const CONFIG_STORE = "agent-hq-config";
const AGENT_KEYS_STORE = "agent-hq-agent-keys";
const API_KEY_KEY = "api-key";

type ApiKeyRecord = { key: string; created_at: string };
type AgentKeyRecord = { agent_id: string; sign_in_name: string; created_at: string };

export async function getOrCreateApiKey(): Promise<string> {
  const s = store(CONFIG_STORE);
  const existing = await readJson<ApiKeyRecord>(s, API_KEY_KEY);
  if (existing?.key) return existing.key;
  const key = `ahq_${nanoid(32)}`;
  await writeJson<ApiKeyRecord>(s, API_KEY_KEY, { key, created_at: new Date().toISOString() });
  return key;
}

export type ApiKeyIdentity =
  | { kind: "master" }
  | { kind: "agent"; agent_id: string; sign_in_name: string }
  | null;

export async function identifyApiKey(provided: string | null): Promise<ApiKeyIdentity> {
  if (!provided) return null;
  const master = await readJson<ApiKeyRecord>(store(CONFIG_STORE), API_KEY_KEY);
  if (master && master.key === provided) return { kind: "master" };
  const agentRecord = await readJson<AgentKeyRecord>(store(AGENT_KEYS_STORE), provided);
  if (agentRecord) {
    return { kind: "agent", agent_id: agentRecord.agent_id, sign_in_name: agentRecord.sign_in_name };
  }
  return null;
}

export async function createAgentKey(agent_id: string, sign_in_name: string): Promise<string> {
  const key = `akey_${nanoid(28)}`;
  await writeJson<AgentKeyRecord>(store(AGENT_KEYS_STORE), key, {
    agent_id,
    sign_in_name,
    created_at: new Date().toISOString(),
  });
  return key;
}
