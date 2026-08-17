import { runValidation } from './ble';

const button = document.getElementById('validate') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const log = document.getElementById('log') as HTMLUListElement;

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
