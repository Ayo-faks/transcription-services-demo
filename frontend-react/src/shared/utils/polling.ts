export function getNextPollDelayMs(attempt: number, baseDelayMs = 2000, maxDelayMs = 15000) {
  const safeAttempt = Math.max(0, attempt)
  const exponentialDelay = baseDelayMs * 2 ** safeAttempt
  return Math.min(maxDelayMs, exponentialDelay)
}