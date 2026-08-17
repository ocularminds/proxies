import { runValidation } from './ble';
import { enroll, getServerUrl, setServerUrl } from './api';
import { getDeviceId } from './keystore';

const button = document.getElementById('validate') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const log = document.getElementById('log') as HTMLUListElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const enrollCodeInput = document.getElementById('enroll-code') as HTMLInputElement;
const enrollButton = document.getElementById('enroll-btn') as HTMLButtonElement;
const enrollStatus = document.getElementById('enroll-status') as HTMLParagraphElement;

function appendLog(message: string) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  log.prepend(item);
}

function setStatus(message: string, kind?: 'ok' | 'fail') {
  status.textContent = message;
  status.className = kind ?? '';
  appendLog(message);
}

async function refreshEnrollmentState() {
  serverUrlInput.value = getServerUrl();
  const deviceId = await getDeviceId();
  enrollStatus.textContent = deviceId
    ? `Enrolled as ${deviceId}`
    : 'Not enrolled yet — validations will be rejected.';
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const result = await runValidation((message) => setStatus(message));
    setStatus(result.message, result.success ? 'ok' : 'fail');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Validation failed: ${message}`, 'fail');
  } finally {
    button.disabled = false;
  }
});

enrollButton.addEventListener('click', async () => {
  enrollButton.disabled = true;
  try {
    const serverUrl = serverUrlInput.value.trim();
    const code = enrollCodeInput.value.trim();
    if (!serverUrl || !code) {
      throw new Error('Server URL and enrollment code are both required.');
    }
    setServerUrl(serverUrl);
    enrollStatus.textContent = 'Enrolling…';
    const deviceId = await enroll(serverUrl, code);
    enrollCodeInput.value = '';
    enrollStatus.textContent = `Enrolled as ${deviceId}`;
    appendLog(`Device enrolled (${deviceId}).`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    enrollStatus.textContent = message;
  } finally {
    enrollButton.disabled = false;
  }
});

void refreshEnrollmentState();
