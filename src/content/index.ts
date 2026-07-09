import { detectRecipe } from './detector';
import { PepperButton } from './button';
import { getSettings, updateSettings } from '../shared/storage';
import type { ExtractedRecipe, Message, SaveResult } from '../shared/types';

let button: PepperButton | null = null;
let currentRecipe: ExtractedRecipe | null = null;
let lastSignature = '';

function send<M extends Message>(message: M): Promise<SaveResult> {
  return chrome.runtime.sendMessage(message);
}

async function handleSave(recipe: ExtractedRecipe): Promise<void> {
  if (!button) return;
  button.setState('saving');
  try {
    const result = await send({ type: 'SAVE_RECIPE', recipe });
    switch (result.status) {
      case 'saved':
        button.setState('saved');
        break;
      case 'duplicate':
        button.setState('duplicate');
        break;
      case 'queued':
        button.setState('error', 'Offline — queued, will retry');
        break;
      case 'error':
        button.setState('error', result.error);
        break;
    }
  } catch {
    button.setState('error', 'Could not reach Pepper');
  }
}

function urlOnlyRecipe(): ExtractedRecipe {
  return {
    sourceUrl: location.href,
    title: document.title,
    ingredients: [],
    instructions: [],
    extractionMethod: 'server',
  };
}

function runDetection(): void {
  const recipe = detectRecipe(document, location.href);
  // Only react when the outcome meaningfully changes (SPA observers fire a lot).
  const signature = recipe ? `${location.href}::${recipe.title}` : `${location.href}::none`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  currentRecipe = recipe;

  button?.setState(recipe ? 'green' : 'red');
  void send({ type: 'DETECTION_CHANGED', hasRecipe: recipe !== null }).catch(() => {
    /* service worker may be waking up; badge will catch up on next change */
  });
}

function watchForChanges(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runDetection, 500);
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // History API navigation (AllRecipes-style SPAs).
  const patch = (method: 'pushState' | 'replaceState'): void => {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      schedule();
    };
  };
  patch('pushState');
  patch('replaceState');
  window.addEventListener('popstate', schedule);
}

async function main(): Promise<void> {
  if (window !== window.top) return; // top frames only
  const settings = await getSettings();

  button = new PepperButton({
    onSave: () => {
      if (currentRecipe) void handleSave(currentRecipe);
    },
    onSaveAnyway: () => void handleSave(urlOnlyRecipe()),
    onPositionChange: (pos) => void updateSettings({ buttonPosition: pos }),
  });
  button.mount(settings.buttonPosition);

  runDetection();
  watchForChanges();
}

void main();
