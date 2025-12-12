/**
 * Create a promise that rejects after timeout
 */
function withTimeout(promise, timeoutMs, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    )
  ])
}

/**
 * Timeout constants for different operations
 */
const TIMEOUTS = {
  IMAGE_FETCH: 30_000,        // 30 seconds per image
  IMAGE_COMPRESSION: 60_000,   // 60 seconds per image
  GPT_VISION_API: 180_000,     // 3 minutes (for 8-10 images)
  JSON_PARSING: 5_000,         // 5 seconds
}

module.exports = {
  withTimeout,
  TIMEOUTS
}
