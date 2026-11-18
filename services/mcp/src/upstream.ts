/**
 * The ledger's and `app`'s APIs, called as the user: the headers Traefik set on the request
 * that reached us (after `auth` checked it) go on, so each service checks the user's role in a
 * book as it does for the PWA.
 */

/** Who's calling, from the forwarded headers. */
export type User = {
  id: string;
  /** X-User-Name, X-User-Email and X-User-Email-Verified, as `auth` sent them (URI-encoded). */
  headers: Record<string, string>;
};

/** A refusal from a service: its status and what it said. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(detail);
  }
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export type Api = {
  get: (path: string, query?: Query) => Promise<unknown>;
  post: (
    path: string,
    body?: unknown,
    query?: Query,
    headers?: Record<string, string>
  ) => Promise<unknown>;
  put: (path: string, body?: unknown, query?: Query) => Promise<unknown>;
  patch: (path: string, body?: unknown, query?: Query) => Promise<unknown>;
  delete: (path: string, query?: Query) => Promise<unknown>;
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a refusal's body says: FastAPI's `detail` (a string, or its validation errors), or
 * `app`'s. */
function detailOf(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) =>
        [d.loc?.filter((l) => l !== "body").join("."), d.msg].filter(Boolean).join(": ")
      )
      .join("; ");
  return typeof body === "string" && body ? body : `failed with status ${status}`;
}

/** A service's API at `base` (`http://ledger:8000/api/ledger/v1`), as `user`. */
export function api(base: string, user: User, fetcher: Fetch = fetch): Api {
  const call = async (
    method: string,
    path: string,
    { body, query, headers }: { body?: unknown; query?: Query; headers?: Record<string, string> }
  ) => {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      for (const v of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(v));
    }
    // A string goes as text (BQL), a form as itself (multipart), anything else as JSON.
    const text = typeof body === "string";
    const form = body instanceof FormData;
    const response = await fetcher(url.href, {
      method,
      headers: {
        "x-user-id": user.id,
        ...user.headers,
        ...(body === undefined || form
          ? {}
          : { "content-type": text ? "text/plain" : "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : text || form ? body : JSON.stringify(body),
    });
    const raw = await response.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // not JSON: kept as text
    }
    if (!response.ok) throw new ApiError(response.status, detailOf(parsed, response.status));
    return parsed;
  };
  return {
    get: (path, query) => call("GET", path, { query }),
    post: (path, body, query, headers) => call("POST", path, { body, query, headers }),
    put: (path, body, query) => call("PUT", path, { body, query }),
    patch: (path, body, query) => call("PATCH", path, { body, query }),
    delete: (path, query) => call("DELETE", path, { query }),
  };
}
