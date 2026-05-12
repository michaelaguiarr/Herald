import { Channel, ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../lib/prisma'

/**
 * Returns ALL eligible channels for an org+type, ordered LRU (least-recently-used first).
 *
 * Filters applied per candidate:
 *   1. status === ACTIVE
 *   2. sentToday < dailyLimit
 *   3. successful attempts in the last hour < hourlyLimit
 *
 * Used by the notification worker for pool rotation: try candidate 1, if it fails
 * try candidate 2, etc., before giving up and scheduling a retry.
 */
export async function selectChannels(
  organizationId: string,
  channelType: ChannelType
): Promise<Channel[]> {
  const candidates = await prisma.channel.findMany({
    where: {
      organizationId,
      type: channelType,
      status: ChannelStatus.ACTIVE,
    },
    orderBy: { lastUsedAt: 'asc' }, // LRU rotation
  })

  if (candidates.length === 0) return []

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const eligible: Channel[] = []

  for (const channel of candidates) {
    if (channel.sentToday >= channel.dailyLimit) continue

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