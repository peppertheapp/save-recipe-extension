import QrCodeWithLogo from 'qrcode-with-logos';
import { renderSVG } from 'uqr';
import { BACKEND_ENABLED } from '../shared/config';
import {
  checkPairingStatus,
  generatePairingCode,
  PAIRING_CODE_ROTATE_MS,
  PAIRING_POLL_INTERVAL_MS,
  pairingUrl,
} from '../shared/pairing';
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
const qrWrap = $('qr-wrap');
const historyList = $<HTMLUListElement>('history');
const historyEmpty = $('history-empty');

// ---- QR pairing ----

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;

async function showPairingQr(): Promise<void> {
  const code = generatePairingCode();
  const content = pairingUrl(code);

  try {
    // Branded QR (qrcode-with-logos): chili badge in the center, high error
    // correction so the badge never breaks scanability.
    const canvas = document.createElement('canvas');
    await new QrCodeWithLogo({
      canvas,
      content,
      width: 400,
      nodeQrCodeOptions: { errorCorrectionLevel: 'H', margin: 2 },
      dotsOptions: { color: '#212121', type: 'rounded' },
      logo: {
        src: chrome.runtime.getURL('icons/qr-logo.png'),
        bgColor: '#ffffff',
        borderRadius: 100,
      },
    }).getCanvas();
    qrWrap.replaceChildren(canvas);
  } catch {
    // Plain QR fallback (uqr) — no canvas/logo, still scannable.
    qrWrap.innerHTML = renderSVG(content, { ecc: 'M', border: 2 });
  }

  if (BACKEND_ENABLED) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void checkPairingStatus(code).then(async (status) => {
        if (!status.linked || !status.userId) return;
        if (pollTimer) clearInterval(pollTimer);
        if (rotateTimer) clearTimeout(rotateTimer);
        await updateSettings({ userId: status.userId });
        setStatus(`Connected as ${status.displayName ?? status.userId} ✓`, true);
      });
    }, PAIRING_POLL_INTERVAL_MS);
  }

  // Rotate the code before its (future) server-side TTL lapses.
  if (rotateTimer) clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => void showPairingQr(), PAIRING_CODE_ROTATE_MS);
}

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
  void showPairingQr();

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
