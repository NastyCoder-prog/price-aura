// lib/api-error.ts
// Errors that are SAFE to show to end users (messages we wrote ourselves,
// e.g. "That does not look like a valid URL."). Anything else — database
// driver errors, unexpected exceptions — must never reach a client, so
// routes convert it to a generic 500 and log the details server-side.

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 400, code = 'bad_request') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || (error as Error | null)?.name === 'ApiError'
}

// Maps an unknown thrown value onto { safe message, status, code } pairs.
// Non-ApiError values are logged in full and reported as an opaque 500.
export function classifyError(
  scope: string,
  error: unknown,
): { message: string; status: number; code: string } {
  if (isApiError(error)) {
    return { message: error.message, status: error.status, code: error.code }
  }
  console.error(`[${scope}]`, error)
  return {
    message: 'Something went wrong on our side. Please try again in a moment.',
    status: 500,
    code: 'internal_error',
  }
}
