import { Channel, ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../lib/prisma'

/**
 * Selects the best available channel from an org's pool for a given type.
 *
 * Rotation strategy (LRU): candidates are ordered by lastUsedAt ASC so the
 * least-recently-used channel is always tried first.
 *
 * Filters applied per candidate:
 *   1. status === ACTIVE
 *   2. sentToday < dailyLimit
 *   3. successful attempts in the last hour < hourlyLimit
 *
 * Returns null when no eligible channel exists (all limits exhausted or
 * no channel configured for the org).
 */
export async function selectChannel(
  organizationId: string,
  channelType: ChannelType
): Promise<Channel | null> {
  const candidates = await prisma.channel.findMany({
    where: {
      organizationId,
      type: channelType,
      status: ChannelStatus.ACTIVE,
    },
    orderBy: { lastUsedAt: 'asc' }, // LRU rotation
  })

  if (candidates.length === 0) return null

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

  for (const channel of candidates) {
    if (channel.sentToday >= channel.dailyLimit) continue

    const sentLastHour = await prisma.notificationAttempt.count({
      where: {
        channelId: channel.id,
        success: true,
        attemptedAt: { gte: hourAgo },
      },
    })

    if (sentLastHour >= channel.hourlyLimit) continue

    return channel
  }

  return null
}
