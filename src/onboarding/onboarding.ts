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
import { getSettings, updateSettings } from '../shared/storage';
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
const doneCard = $('done');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(text: string, ok: boolean): void {
  connectStatus.textContent = text;
  connectStatus.className = `status ${ok ? 'ok' : 'err'}`;
}

function markConnected(label: string): void {
  setStatus(label, true);
  doneCard.classList.add('show');
  if (pollTimer) clearInterval(pollTimer);
  if (rotateTimer) clearTimeout(rotateTimer);
}

async function verify(userId: string): Promise<VerifyResult> {
  const message: Message = { type: 'VERIFY_USER', userId };
  return chrome.runtime.sendMessage(message);
}

async function showPairingQr(): Promise<void> {
  const code = generatePairingCode();
  const content = pairingUrl(code);

  try {
    const canvas = document.createElement('canvas');
    await new QrCodeWithLogo({
      canvas,
      content,
      width: 440,
      nodeQrCodeOptions: { errorCorrectionLevel: 'H', margin: 2 },
      dotsOptions: { color: '#212121', type: 'rounded' },
      logo: { src: chrome.runtime.getURL('icons/qr-logo.png'), bgColor: '#ffffff', borderRadius: 100 },
    }).getCanvas();
    qrWrap.replaceChildren(canvas);
  } catch {
    qrWrap.innerHTML = renderSVG(content, { ecc: 'M', border: 2 });
  }

  if (BACKEND_ENABLED) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void checkPairingStatus(code).then(async (status) => {
        if (!status.linked || !status.userId) return;
        await updateSettings({ userId: status.userId });
        markConnected(`Connected as ${status.displayName ?? status.userId} ✓`);
      });
    }, PAIRING_POLL_INTERVAL_MS);
  }

  if (rotateTimer) clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => void showPairingQr(), PAIRING_CODE_ROTATE_MS);
}

connectBtn.addEventListener('click', () => {
  void (async () => {
    const userId = userIdInput.value.trim();
    if (!userId) return;
    if (!BACKEND_ENABLED) {
      // Frontend-only mode: store the code without verification (see shared/config.ts).
      await updateSettings({ userId });
      markConnected('Secret code saved ✓');
      return;
    }
    connectBtn.disabled = true;
    setStatus('Checking…', true);
    const result = await verify(userId);
    connectBtn.disabled = false;
    if (result.valid) {
      await updateSettings({ userId });
      markConnected(`Connected as ${result.displayName ?? userId} ✓`);
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
    markConnected(BACKEND_ENABLED ? 'Connected ✓' : 'Secret code saved ✓');
  }
}

void init();
