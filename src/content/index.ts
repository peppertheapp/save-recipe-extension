import { detectRecipe } from './detector';
import { detectSocialRecipe } from './social';
import { PepperButton } from './button';
import { CompetitorOverlay, targetsForHost, type CardRecipeRef } from './competitor';
import { getSettings, updateSettings } from '../shared/storage';
import type { ExtractedRecipe, Message, SaveResult } from '../shared/types';

let button: PepperButton | null = null;
let currentRecipe: ExtractedRecipe | null = null;
let lastSignature = '';

function send<M extends Message>(message: M): Promise<SaveResult> {
  return chrome.runtime.sendMessage(message);
}

async function saveCurrentRecipe(): Promise<SaveResult> {
  if (!currentRecipe) return { status: 'error', error: 'No recipe on this page.' };
  try {
    return await send({ type: 'SAVE_RECIPE', recipe: currentRecipe });
  } catch {
    return { status: 'error', error: 'Could not reach Pepper' };
  }
}

async function handleFloatingSave(): Promise<void> {
  if (!button) return;
  button.setState('saving');
  const result = await saveCurrentRecipe();
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
}

function runDetection(): void {
  // Structured data first; social captions (IG/TikTok/FB/Pinterest) as fallback.
  const recipe = detectRecipe(document, location.href) ?? detectSocialRecipe(document, location.href);
  // Only react when the outcome meaningfully changes (SPA observers fire a lot).
  const signature = recipe ? `${location.href}::${recipe.title}` : `${location.href}::none`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  currentRecipe = recipe;

  // No recipe → no button. It only exists when there's something to save.
  if (recipe) {
    button?.setState('green');
    button?.show();
  } else {
    button?.hide();
  }
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
    onSave: () => void handleFloatingSave(),
    onPositionChange: (pos) => void updateSettings({ buttonPosition: pos }),
  });
  button.mount(settings.buttonPosition);

  // MyRecipes-network sites: Pepper's save button overlays theirs.
  const competitorTarget = targetsForHost(location.hostname);
  if (competitorTarget) {
    const overlay = new CompetitorOverlay(competitorTarget, async (card: CardRecipeRef | null) => {
      // Roundup-card buttons save their own recipe (URL stub, extracted
      // server-side later); recipe-page buttons save the detected recipe.
      const result = card
        ? await send({
            type: 'SAVE_RECIPE',
            recipe: {
              sourceUrl: card.url,
              title: card.title ?? card.url,
              ingredients: [],
              instructions: [],
              extractionMethod: 'server',
            },
          }).catch((): SaveResult => ({ status: 'error', error: 'Could not reach Pepper' }))
        : await saveCurrentRecipe();
      if (result.status === 'saved' || result.status === 'queued') return 'saved';
      if (result.status === 'duplicate') return 'duplicate';
      return 'error';
    });
    overlay.start();
  }

  runDetection();
  watchForChanges();
}

void main();
