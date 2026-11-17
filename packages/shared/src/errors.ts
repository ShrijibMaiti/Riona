/**
 * The error contract between the API and the UI.
 *
 * Every non-2xx response from the API has this body. The frontend shows `message` to the user as written,
 * so it is UI copy ("Give a reason for rejecting."), never a stack trace or a database message.
 */
export type ApiErrorBody = {
  error: {
    message: string;
    /** Stable, machine-readable. The UI may branch on it; never on `message`. */
    code: ErrorCode;
    /** Per-field messages for form validation (422). */
    fields?: Record<string, string>;
    /** Echoes the X-Request-Id of the failed request, for support. */
    requestId?: string;
  };
};

/** Generic codes, one per status the API uses. Domain codes are added beside them as modules arrive. */
export const ErrorCodes = {
  BAD_REQUEST: 'bad_request',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  CSRF: 'csrf',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  GONE: 'gone',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  VALIDATION: 'validation',
  RATE_LIMITED: 'rate_limited',
  INTERNAL: 'internal',
  UNAVAILABLE: 'unavailable',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | (string & {});

/** The status each generic code is sent with. */
export const STATUS_OF: Record<(typeof ErrorCodes)[keyof typeof ErrorCodes], number> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  csrf: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  payload_too_large: 413,
  validation: 422,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};