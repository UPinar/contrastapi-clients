// Error classes of the SDK. No error holds the API key. Each message comes from the response
// body or from fixed client text. With the built-in fetch, a `cause` is the fetch error, which carries no headers.

/** ContrastAPIError is the base class of every SDK error. The client raises it for an error status that has no subclass and for a body it cannot read. */
export class ContrastAPIError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number|null, code?: string|null, retryAfter?: number|null,
   *          rateLimit?: object|null, cause?: unknown}} [options]
   */
  constructor(message, options = {}) {
    const { status = null, code = null, retryAfter = null, rateLimit = null, cause } = options;
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.rateLimit = rateLimit;
  }
}

/** BadRequestError is an HTTP 400 answer. */
export class BadRequestError extends ContrastAPIError {}
/** AuthenticationError is an HTTP 401 answer. */
export class AuthenticationError extends ContrastAPIError {}
/** NotFoundError is an HTTP 404 answer. */
export class NotFoundError extends ContrastAPIError {}
/** RateLimitError is an HTTP 429 answer. */
export class RateLimitError extends ContrastAPIError {}
/** UpstreamError is an HTTP 502, 503 or 504 answer. */
export class UpstreamError extends ContrastAPIError {}

/** APIConnectionError means no usable answer arrived: a DNS or TLS failure, a reset or a refused redirect. */
export class APIConnectionError extends ContrastAPIError {}

/** APITimeoutError means the request ran past timeoutMs. */
export class APITimeoutError extends APIConnectionError {}

/**
 * errorClassForStatus picks the class for an HTTP error status.
 * @param {number} status
 * @returns {typeof ContrastAPIError}
 */
export function errorClassForStatus(status) {
  switch (status) {
    case 400:
      return BadRequestError;
    case 401:
      return AuthenticationError;
    case 404:
      return NotFoundError;
    case 429:
      return RateLimitError;
    case 502:
    case 503:
    case 504:
      return UpstreamError;
    default:
      return ContrastAPIError;
  }
}
