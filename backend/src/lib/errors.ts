/**
 * The one error type services throw. The error plugin (http/plugins/errors.ts) turns it into the response body
 * the frontend expects: { error: { message, code, fields? } }.
 *
 * `message` is shown to the user verbatim, so write it as UI copy, in the frontend's plain voice:
 *   throw unprocessable('Give a reason for rejecting.', { comment: 'Required' })
 */
import { ErrorCodes, type ErrorCode } from '@riona/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ErrorCode,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export const badRequest = (message = 'That request wasn’t valid.', code: ErrorCode = ErrorCodes.BAD_REQUEST) =>
  new ApiError(400, message, code);

export const unauthenticated = (message = 'Your session has ended. Sign in again.') =>
  new ApiError(401, message, ErrorCodes.UNAUTHENTICATED);

export const forbidden = (message = 'You don’t have access to this.', code: ErrorCode = ErrorCodes.FORBIDDEN) =>
  new ApiError(403, message, code);

export const notFound = (message = 'We couldn’t find that.', code: ErrorCode = ErrorCodes.NOT_FOUND) =>
  new ApiError(404, message, code);

/** State conflicts: already decided, already billed, room taken, run closed. */
export const conflict = (message = 'This changed in the meantime. Refresh and try again.', code: ErrorCode = ErrorCodes.CONFLICT) =>
  new ApiError(409, message, code);

export const gone = (message = 'This link has expired.', code: ErrorCode = ErrorCodes.GONE) => new ApiError(410, message, code);

export const unprocessable = (message = 'Check the highlighted details and try again.', fields?: Record<string, string>, code: ErrorCode = ErrorCodes.VALIDATION) =>
  new ApiError(422, message, code, fields);

export const internal = (message = 'Something went wrong on our side. Try again in a moment.') =>
  new ApiError(500, message, ErrorCodes.INTERNAL);

export const unavailable = (message = 'Riona is busy right now. Try again in a moment.') =>
  new ApiError(503, message, ErrorCodes.UNAVAILABLE);