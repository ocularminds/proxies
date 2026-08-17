// Renderer status page. Compiled as a plain browser script — no imports here,
// so the event types are mirrored from src/events.ts; keep the two in sync.
interface StatusValidationResult {
  success: boolean;
  message: string;
}

interface StatusEventPayload {
  type: string;
  state?: string;
  name?: string;
  clientAddress?: string;
  metrics?: { deviceId?: string };
  result?: StatusValidationResult;
  message?: string;
  hostAddress?: string;
  serverUrl?: string;
  hostId?: string | null;
}

interface Window {
  proxies: { onEvent(handler: (payload: StatusEventPayload) => void): void };
}

const infoEl = document.getElementById('info') as HTMLDivElement;
const eventsEl = document.getElementById('events') as HTMLUListElement;

function describe(payload: StatusEventPayload): string {
  switch (payload.type) {
    case 'state':
      return `Bluetooth ${payload.state}`;
    case 'advertising':
      return `Advertising as "${payload.name}"`;
    case 'connected':
      return `Device connected (${payload.clientAddress})`;
    case 'disconnected':
      return `Device disconnected (${payload.clientAddress})`;
    case 'metrics-received':
      return `Metrics received from ${payload.metrics?.deviceId ?? 'unknown device'}`;
    case 'validation-result':
      return payload.result?.message ?? 'Validation result';
    case 'error':
      return payload.message ?? 'Error';
    default:
      return payload.type;
  }
}

(window as unknown as Window).proxies.onEvent((payload) => {
  if (payload.type === 'host-info') {
    const enrollment = payload.hostId ? `host ${payload.hostId}` : 'NOT ENROLLED';
    infoEl.textContent = `LAN ${payload.hostAddress} → server ${payload.serverUrl} · ${enrollment}`;
    return;
  }
  const item = document.createElement('li');
  if (payload.type === 'validation-result') {
    item.className = payload.result?.success ? 'ok' : 'fail';
  }
  if (payload.type === 'error') {
    item.className = 'fail';
  }
  item.textContent = `${new Date().toLocaleTimeString()} — ${describe(payload)}`;
  eventsEl.prepend(item);
});
