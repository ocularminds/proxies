import type { RuleRecord } from './stores';

export interface AlertNotification {
  alertId: number;
  rule: RuleRecord;
  deviceUuid: string;
  readingTs: string;
  value: number;
}

export type Notifier = (notification: AlertNotification) => Promise<void>;

// Default delivery: the rule's webhook when it has one, loud console otherwise
// (SMS/WhatsApp adapters plug in here later).
export const defaultNotifier: Notifier = async ({ rule, deviceUuid, readingTs, value }) => {
  const payload = {
    ruleId: rule.id,
    metricType: rule.metricType,
    op: rule.op,
    threshold: rule.threshold,
    deviceUuid,
    readingTs,
    value,
  };
  if (rule.webhookUrl) {
    const response = await fetch(rule.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error(`Webhook answered ${response.status}`);
    }
    return;
  }
  console.warn('ALERT:', JSON.stringify(payload));
};
