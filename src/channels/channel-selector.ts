import { Channel, ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../lib/prisma'

/** Max messages/day for a WhatsApp channel still in the 7-day warm-up period. */
const WARMUP_DAILY_LIMIT = 20

/**
 * Returns ALL eligible channels for an org+type, ordered LRU (least-recently-used first).
 *
 * Filters applied per candidate:
 *   1. status === ACTIVE  OR  status === WARMING with connectedAt set (warm-up phase)
 *   2. sentToday < effectiveDailyLimit  (WARMING channels are capped at WARMUP_DAILY_LIMIT)
 *   3. successful attempts in the last hour < hourlyLimit
 *
 * Anti-spam deduplication (WhatsApp only, when recipientPhone provided):
 *   If the same recipient already received a WhatsApp message today from this org,
 *   only the specific channel that sent it is returned.  This prevents contacting
 *   the same person from different numbers on the same day.
 */
export async function selectChannels(
  organizationId: string,
  channelType: ChannelType,
  opts?: { recipientPhone?: string | null }
): Promise<Channel[]> {
  const candidates = await prisma.channel.findMany({
    where: {
      organizationId,
      type: channelType,
      OR: [
        { status: ChannelStatus.ACTIVE },
        // WARMING channels with connectedAt set are connected and warming up (7-day period)
        { status: ChannelStatus.WARMING, connectedAt: { not: null } },
      ],
    },
    orderBy: { lastUsedAt: 'asc' }, // LRU rotation
  })

  if (candidates.length === 0) return []

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const eligible: Channel[] = []

  for (const channel of candidates) {
    // WARMING channels use a lower daily limit during the warm-up period
    const effectiveDailyLimit =
      channel.status === ChannelStatus.WARMING
        ? Math.min(channel.dailyLimit, WARMUP_DAILY_LIMIT)
        : channel.dailyLimit

    if (channel.sentToday >= effectiveDailyLimit) continue

    const sentLastHour = await prisma.notificationAttempt.count({
      where: {
        channelId: channel.id,
        success: true,
        attemptedAt: { gte: hourAgo },
      },
    })

    if (sentLastHour < channel.hourlyLimit) {
      eligible.push(channel)
    }
  }

  if (eligible.length === 0) return []

  // Anti-spam: for WhatsApp pools with multiple channels, prevent contacting the same
  // recipient from a different number if one already sent to them today.
  if (channelType === ChannelType.WHATSAPP && opts?.recipientPhone && eligible.length > 1) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const priorAttempt = await prisma.notificationAttempt.findFirst({
      where: {
        success: true,
        attemptedAt: { gte: todayStart },
        notification: {
          organizationId,
          channelType: ChannelType.WHATSAPP,
          recipientPhone: opts.recipientPhone,
        },
      },
      select: { channelId: true },
      orderBy: { attemptedAt: 'desc' },
    })

    if (priorAttempt) {
      // Recipient already received from a specific channel today — stick to that one
      const sameChannel = eligible.find((c) => c.id === priorAttempt.channelId)
      return sameChannel ? [sameChannel] : []
    }
  }

  return eligible
}

/** Convenience wrapper — returns the single best channel (first in LRU order). */
export async function selectChannel(
  organizationId: string,
  channelType: ChannelType
): Promise<Channel | null> {
  const channels = await selectChannels(organizationId, channelType)
  return channels[0] ?? null
}
