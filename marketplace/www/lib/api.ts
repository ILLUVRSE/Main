export type ApiResult<T> = {
  data?: T;
  error?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

async function handleResponse<T>(res: Response): Promise<ApiResult<T>> {
  if (!res.ok) {
    return { error: `Request failed with status ${res.status}` };
  }
  const data = (await res.json()) as T;
  return { data };
}

export async function apiGet<T>(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, init);
  return handleResponse<T>(res);
}

export async function apiPost<TBody, TResponse>(path: string, body: TBody, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  return handleResponse<TResponse>(res);
}
