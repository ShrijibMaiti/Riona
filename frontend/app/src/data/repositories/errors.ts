/**
 * The one error type every repository rejects with, whichever data source is active. Screens show `message`
 * verbatim, so it is UI copy. Over HTTP it comes from the API's body: { error: { message, code, fields? } }
 * (packages/shared/src/errors.ts).
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable machine-readable code from the API ('validation', 'conflict', …). Branch on this, never on message. */
    public code?: string,
    /** Per-field messages on a 422. */
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
