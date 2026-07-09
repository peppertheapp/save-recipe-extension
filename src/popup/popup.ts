import { BACKEND_ENABLED } from '../shared/config';
import { getHistory, getSettings, updateSettings } from '../shared/storage';
import type { Message, VerifyResult } from '../shared/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const userIdInput = $<HTMLInputElement>('user-id');
const connectBtn = $<HTMLButtonElement>('connect');
const connectStatus = $('connect-status');
const historyList = $<HTMLUListElement>('history');
const historyEmpty = $('history-empty');

function setStatus(text: string, ok: boolean): void {
  connectStatus.textContent = text;
  connectStatus.className = `status ${ok ? 'ok' : 'err'}`;
}

async function verify(userId: string): Promise<VerifyResult> {
  const message: Message = { type: 'VERIFY_USER', userId };
  return chrome.runtime.sendMessage(message);
}

connectBtn.addEventListener('click', () => {
  void (async () => {
    const userId = userIdInput.value.trim();
    if (!userId) return;
    if (!BACKEND_ENABLED) {
      // Frontend-only mode: store the code without verification. Account
      // verification switches on with the backend (see shared/config.ts).
      await updateSettings({ userId });
      setStatus('Secret code saved ✓', true);
      return;
    }
    connectBtn.disabled = true;
    setStatus('Checking…', true);
    const result = await verify(userId);
    connectBtn.disabled = false;
    if (result.valid) {
      await updateSettings({ userId });
      setStatus(`Connected as ${result.displayName ?? userId} ✓`, true);
    } else {
      setStatus(result.error ?? 'Secret code not found.', false);
    }
  })();
});

async function init(): Promise<void> {
  const settings = await getSettings();

  if (settings.userId) {
    userIdInput.value = settings.userId;
    if (!BACKEND_ENABLED) {
      setStatus('Secret code saved ✓', true);
    } else {
      const result = await verify(settings.userId);
      if (result.valid) setStatus(`Connected as ${result.displayName ?? settings.userId} ✓`, true);
      else setStatus('Connection needs attention — reconnect.', false);
    }
  }

  const history = await getHistory();
  if (history.length > 0) {
    historyEmpty.style.display = 'none';
    for (const entry of history) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = entry.sourceUrl;
      a.textContent = entry.title;
      a.target = '_blank';
      a.rel = 'noreferrer';
      li.appendChild(a);
      historyList.appendChild(li);
    }
  }
}

void init();
