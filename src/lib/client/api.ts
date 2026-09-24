"use client";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields: Record<string, string[]> = {}) {
    super(message);
  }
}

/** Calls /api/v1 from the browser. Errors come back in the API's own words. */
export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body || init.form ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  const payload = (await res.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string[]> };
  if (!res.ok) throw new ApiError(payload.error ?? "Something went wrong.", res.status, payload.fields ?? {});
  return payload as T;
}
