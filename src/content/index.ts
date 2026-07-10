import { detectRecipe } from './detector';
import { detectSocialRecipe } from './social';
import { PepperButton } from './button';
import { CompetitorOverlay, targetsForHost, type CardRecipeRef } from './competitor';
import { isCollectionPage, MigrationBanner } from './migration';
import { getSettings, updateSettings } from '../shared/storage';
import type { ExtractedRecipe, Message, SaveResult } from '../shared/types';

let button: PepperButton | null = null;
let overlay: CompetitorOverlay | null = null;
let banner: MigrationBanner | null = null;
let currentRecipe: ExtractedRecipe | null = null;
let lastSignature = '';
let dead = false;

/**
 * After an extension update/reload, this orphaned script's chrome APIs throw
 * synchronously ("Extension context invalidated"). Detect it and go quiet:
 * remove all Pepper UI and stop observing. The page just needs a reload.
 */
function teardown(): void {
  if (dead) return;
  dead = true;
  button?.destroy();
  button = null;
  overlay?.destroy();
  overlay = null;
  banner?.destroy();
  banner = null;
}

function contextAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function send<M extends Message>(message: M): Promise<SaveResult> {
  try {
    if (!contextAlive()) throw new Error('extension context invalidated');
    return chrome.runtime.sendMessage(message);
  } catch {
    teardown();
    return Promise.resolve({ status: 'error', error: 'Pepper was updated — reload the page.' });
  }
}

async function saveCurrentRecipe(): Promise<SaveResult> {
  if (!currentRecipe) return { status: 'error', error: 'No recipe on this page.' };
  // Some sites (e.g. provecho.co) publish Recipe JSON-LD with empty
  // ingredients/instructions to gate content. Flag those saves for
  // server-side re-extraction instead of storing them as complete.
  const recipe: ExtractedRecipe =
    currentRecipe.ingredients.length === 0 && currentRecipe.instructions.length === 0
      ? { ...currentRecipe, extractionMethod: 'server' }
      : currentRecipe;
  try {
    return await send({ type: 'SAVE_RECIPE', recipe });
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
  if (dead) return;
  if (!contextAlive()) {
    teardown();
    return;
  }
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
    if (dead) return;
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
    onPositionChange: (pos) => {
      try {
        void updateSettings({ buttonPosition: pos }).catch(() => teardown());
      } catch {
        teardown();
      }
    },
  });
  button.mount(settings.buttonPosition);

  // MyRecipes-network sites: Pepper's save button overlays theirs.
  const competitorTarget = targetsForHost(location.hostname);
  if (competitorTarget) {
    overlay = new CompetitorOverlay(competitorTarget, async (card: CardRecipeRef | null) => {
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

  // Saved-collection pages (MyRecipes favorites): offer one-click import.
  if (isCollectionPage(location.href)) {
    banner = new MigrationBanner(async (recipe) => {
      const result = await send({ type: 'SAVE_RECIPE', recipe });
      if (result.status === 'saved' || result.status === 'queued') return 'saved';
      if (result.status === 'duplicate') return 'duplicate';
      return 'error';
    });
    banner.mount();
  }

  runDetection();
  watchForChanges();
}

void main();
