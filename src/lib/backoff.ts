/**
 * Calculates a reconnect delay with exponential backoff and full jitter.
 *
 * Formula: min(baseMs * 2^attempt, maxMs) + random(0, jitterMs)
 *
 * The jitter spreads reconnects across a time window, preventing the
 * "thundering herd" problem where many channels reconnect simultaneously
 * after a shared outage (e.g. network drop or server restart).
 *
 * @example
 * // base=2000, max=60000, jitter=1000 (defaults)
 * calculateBackoff(0) → 2000–3000 ms   (~2s)
 * calculateBackoff(1) → 4000–5000 ms   (~4s)
 * calculateBackoff(2) → 8000–9000 ms   (~8s)
 * calculateBackoff(3) → 16000–17000 ms (~16s)
 * calculateBackoff(4) → 32000–33000 ms (~32s)
 * calculateBackoff(5) → 60000–61000 ms (~60s, capped)
 */
export function calculateBackoff(
  attempt: number,
  options?: {
    baseMs?:   number   // base delay — default 2000 ms
    maxMs?:    number   // hard cap   — default 60000 ms (1 min)
    jitterMs?: number   // max jitter — default 1000 ms
  }
): number {
  const baseMs   = options?.baseMs   ?? 2_000
  const maxMs    = options?.maxMs    ?? 60_000
  const jitterMs = options?.jitterMs ?? 1_000

  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs)
  const jitter = Math.random() * jitterMs

  return Math.floor(exponential + jitter)
}
