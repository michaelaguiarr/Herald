import { redis } from './redis'

// Key schema:
//   whatsapp:jid:{digits}       → resolved JID string, TTL 24h
//   whatsapp:pn:{lid}           → phone digits (reverse LID→phone), TTL 24h
//   whatsapp:jid:stats:hits     → INCR counter (reset daily by scheduler)
//   whatsapp:jid:stats:misses   → INCR counter (reset daily by scheduler)

const KEY_PREFIX    = 'whatsapp:jid:'
const PN_PREFIX     = 'whatsapp:pn:'   // reverse: LID user → phone digits
const STATS_HITS    = 'whatsapp:jid:stats:hits'
const STATS_MISSES  = 'whatsapp:jid:stats:misses'

// 24h TTL: long enough to serve recurring recipients (dizimistas, mass sends)
// without accumulating stale entries. JIDs are stable unless a user migrates
// devices; the worst case is a single failed send in a 24h window.
export const JID_CACHE_TTL_SECONDS = 86_400

function cacheKey(phone: string): string {
  return `${KEY_PREFIX}${phone.replace(/\D/g, '')}`
}

/**
 * Returns the cached resolved JID for a phone number, or null on miss/error.
 * All Redis errors are swallowed so a cache failure is transparent to callers.
 */
export async function getCachedJid(phone: string): Promise<string | null> {
  try {
    const jid = await redis.get(cacheKey(phone))
    if (jid) {
      redis.incr(STATS_HITS).catch(() => {})
      return jid
    }
    redis.incr(STATS_MISSES).catch(() => {})
    return null
  } catch {
    // Redis unavailable — degrade gracefully, caller will call onWhatsApp()
    return null
  }
}

/**
 * Stores the resolved JID for a phone number.
 * Fire-and-forget safe: errors are swallowed; a cache miss on next request is fine.
 */
export async function setCachedJid(phone: string, jid: string): Promise<void> {
  try {
    await redis.setex(cacheKey(phone), JID_CACHE_TTL_SECONDS, jid)
  } catch {
    // non-critical — next request will resolve via onWhatsApp()
  }
}

/**
 * Removes the cached JID for a phone number.
 * Use when a delivery permanently failed (number changed / migrated device).
 */
export async function invalidateCachedJid(phone: string): Promise<void> {
  try {
    await redis.del(cacheKey(phone))
  } catch {}
}

/**
 * Stores the reverse LID→phone mapping.
 * Called after sendMessage successfully resolves a LID-based JID so that
 * incoming messages from that LID can be matched back to the phone number.
 * lid = the user part before '@' from a '@lid' JID (e.g. "54954257608829")
 * phone = digits only (e.g. "5595991234567")
 */
export async function setPhoneForLid(lid: string, phone: string): Promise<void> {
  try {
    await redis.setex(`${PN_PREFIX}${lid}`, JID_CACHE_TTL_SECONDS, phone)
  } catch {}
}

/**
 * Resolves a LID back to a phone number (digits only).
 * Returns null if no mapping exists (i.e., we've never sent a message to this LID).
 */
export async function getPhoneForLid(lid: string): Promise<string | null> {
  try {
    return await redis.get(`${PN_PREFIX}${lid}`)
  } catch {
    return null
  }
}

/**
 * Returns today's JID cache hit/miss counters.
 * Counters are reset daily by the scheduler (daily-reset-sent-today job).
 */
export async function getJidCacheStats(): Promise<{ hits: number; misses: number }> {
  try {
    const [h, m] = await redis.mget(STATS_HITS, STATS_MISSES)
    return {
      hits:   parseInt(h   ?? '0', 10),
      misses: parseInt(m ?? '0', 10),
    }
  } catch {
    return { hits: 0, misses: 0 }
  }
}

/**
 * Resets the daily hit/miss counters.
 * Called by the daily-reset-sent-today scheduler job alongside sentToday resets.
 */
export async function resetJidCacheStats(): Promise<void> {
  try {
    await redis.del(STATS_HITS, STATS_MISSES)
  } catch {}
}
