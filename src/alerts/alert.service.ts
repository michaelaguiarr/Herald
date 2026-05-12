import { alertQueue, type AlertJobData } from '../queues/alert.queue'

/**
 * Enqueues an alert to be delivered via Telegram to the organization's admins.
 * Fire-and-forget: errors are caught and logged by the alert worker.
 */
export function enqueueAlert(
  event: AlertJobData['event'],
  organizationId: string,
  message: string,
  targetId?: string
): void {
  alertQueue
    .add('alert', { event, organizationId, message, targetId })
    .catch((err) => console.error('[alert] Falha ao enfileirar alerta:', err))
}
