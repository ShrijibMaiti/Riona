/**
 * The one place the frontend talks to the network. Every repository call becomes a fetch to the API under
 * VITE_API_BASE_URL; a non-2xx answer becomes an ApiError carrying the API's message, so screens keep showing it.
 */
import { ApiError } from '../errors';
import { encodeQuery, type Endpoint, type Req } from './endpoints';

/** Dispatched on window when the API answers 401 to anything but sign-in. */
export const UNAUTHORIZED_EVENT = 'riona:unauthorized';

export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
const BASE = API_BASE;

/** Fallback copy when an error response has no usable body (a proxy page, a dropped connection). */
const FALLBACK: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'You don’t have access to this.',
  404: 'We couldn’t find that.',
  409: 'This changed in the meantime. Refresh and try again.',
  422: 'Check the highlighted details and try again.',
  429: 'Too many requests. Wait a moment and try again.',
};

function buildPath(pattern: string, params: Req['params'] = {}): string {
  return pattern.replace(/:(\w+)/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined || v === null || v === '') throw new ApiError(400, 'That request wasn’t valid.', 'bad_request');
    return encodeURIComponent(String(v));
  });
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string; fields?: Record<string, string> } };
    if (body?.error?.message) return new ApiError(res.status, body.error.message, body.error.code, body.error.fields);
  } catch {
    /* not JSON */
  }
  const message = FALLBACK[res.status] ?? (res.status >= 500 ? 'Something went wrong on our side. Try again in a moment.' : 'That request wasn’t valid.');
  return new ApiError(res.status, message);
}

export async function request<T>(endpoint: Endpoint<any>, req: Req): Promise<T> {
  const [method, pattern] = endpoint.routes[req.route ?? 0].split(' ');
  const url = BASE + buildPath(pattern, req.params) + encodeQuery(req.query);
  // X-Requested-With: the API refuses state-changing requests without it (CSRF, backend http/plugins/csrf.ts).
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'riona' };
  let body: string | Blob | undefined;
  if (typeof Blob !== 'undefined' && req.body instanceof Blob) {
    // An upload: the file's bytes as they are, its name in a header (POST /uploads).
    headers['Content-Type'] = req.body.type || 'application/octet-stream';
    headers['X-Filename'] = encodeURIComponent((req.body as File).name ?? 'file');
    body = req.body;
  } else if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Can’t reach Riona. Check your connection and try again.', 'network');
  }
  if (!res.ok) {
    // The session is gone (signed out elsewhere, expired, deactivated): the app returns to sign-in (App.tsx).
    // A failed sign-in also answers 401, but that is the sign-in form's own error to show.
    if (res.status === 401 && pattern !== '/auth/login' && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw await toApiError(res);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
