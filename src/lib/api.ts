const API_KEY_STORAGE = "agent_hq_api_key";

export function getApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string) {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export async function call<T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const key = getApiKey();
  const res = await fetch("/api/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-API-Key": key } : {}),
    },
    body: JSON.stringify({ action, params }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json.data as T;
}
