import { importRecipe, NetworkError, verifyUser } from '../shared/api';
import { generateInstructions } from '../shared/ai';
import { BACKEND_ENABLED } from '../shared/config';
import {
  getLocalRecipes,
  getQueue,
  getSettings,
  pushHistory,
  saveLocalRecipe,
  setQueue,
} from '../shared/storage';
import type { ExtractedRecipe, Message, QueuedSave, SaveResult } from '../shared/types';

const RETRY_ALARM = 'pepper-retry-queue';
const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 60_000; // 1m, 2m, 4m, ... capped at 1h

const ICON_SET = (color: 'green' | 'red'): Record<number, string> => ({
  16: `icons/pepper-${color}-16.png`,
  32: `icons/pepper-${color}-32.png`,
  48: `icons/pepper-${color}-48.png`,
  128: `icons/pepper-${color}-128.png`,
});

chrome.runtime.onInstalled.addListener((details) => {
  void chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  // First install → open the onboarding tab so the user can connect right away
  // instead of hunting for the toolbar popup.
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html') });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void drainQueue();
});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.type) {
    case 'DETECTION_CHANGED': {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        void chrome.action.setIcon({
          tabId,
          path: ICON_SET(message.hasRecipe ? 'green' : 'red'),
        });
      }
      return false;
    }
    case 'SAVE_RECIPE':
      void handleSave(message.recipe).then(sendResponse);
      return true; // async response
    case 'VERIFY_USER':
      void getSettings()
        .then((s) => verifyUser(message.userId, s.apiBaseUrl))
        .then(sendResponse);
      return true;
  }
});

async function handleSave(recipe: ExtractedRecipe): Promise<SaveResult> {
  const settings = await getSettings();
  if (!settings.userId) {
    return { status: 'error', error: 'Enter your secret code in the Pepper popup first.' };
  }
  if (!BACKEND_ENABLED) return handleLocalSave(recipe);
  try {
    const result = await importRecipe(settings.userId, recipe, settings.apiBaseUrl);
    if (result.status === 'saved' || result.status === 'duplicate') {
      await pushHistory({
        title: recipe.title,
        sourceUrl: recipe.sourceUrl,
        savedAt: Date.now(),
        recipeId: result.recipeId,
      });
    }
    return result;
  } catch (err) {
    if (err instanceof NetworkError) {
      await enqueue(recipe, settings.userId);
      return { status: 'queued' };
    }
    return { status: 'error', error: 'Unexpected error saving recipe.' };
  }
}

/**
 * Frontend-only mode (BACKEND_ENABLED = false): keep the fully-extracted recipe
 * in chrome.storage.local, deduped by URL, ready to sync when the backend ships.
 */
async function handleLocalSave(recipe: ExtractedRecipe): Promise<SaveResult> {
  const existing = await getLocalRecipes();
  if (existing[recipe.sourceUrl]) return { status: 'duplicate' };
  await saveLocalRecipe({ recipe, savedAt: Date.now() });
  await pushHistory({ title: recipe.title, sourceUrl: recipe.sourceUrl, savedAt: Date.now() });
  // Ingredients but no steps (they're in the video) → ask the backend to
  // generate them with Claude, patch the stored record. Fire-and-forget so
  // the save returns instantly; the inspector shows steps once they land.
  if (recipe.ingredients.length >= 2 && recipe.instructions.length === 0) {
    void enrichInstructions(recipe.sourceUrl, recipe.title, recipe.ingredients);
  }
  return { status: 'saved' };
}

/** Ask the backend to generate instructions, then merge them into the stored record. */
async function enrichInstructions(url: string, title: string, ingredients: string[]): Promise<void> {
  const settings = await getSettings();
  const steps = await generateInstructions(title, ingredients, url, settings.apiBaseUrl);
  if (!steps || steps.length === 0) return;
  const recipes = await getLocalRecipes();
  const entry = recipes[url];
  if (!entry || entry.recipe.instructions.length > 0) return; // gone or filled meanwhile
  entry.recipe.instructions = steps;
  entry.recipe.instructionsSource = 'ai';
  await saveLocalRecipe(entry);
}

async function enqueue(recipe: ExtractedRecipe, userId: string): Promise<void> {
  const queue = await getQueue();
  // Dedupe queued saves on canonical URL so retries never double-post.
  if (queue.some((q) => q.recipe.sourceUrl === recipe.sourceUrl && q.userId === userId)) return;
  queue.push({
    recipe,
    userId,
    attempts: 0,
    nextAttemptAt: Date.now() + BASE_BACKOFF_MS,
    enqueuedAt: Date.now(),
  });
  await setQueue(queue);
}

async function drainQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;
  const settings = await getSettings();
  const now = Date.now();
  const remaining: QueuedSave[] = [];

  for (const item of queue) {
    if (item.nextAttemptAt > now) {
      remaining.push(item);
      continue;
    }
    try {
      const result = await importRecipe(item.userId, item.recipe, settings.apiBaseUrl);
      if (result.status === 'saved' || result.status === 'duplicate') {
        await pushHistory({
          title: item.recipe.title,
          sourceUrl: item.recipe.sourceUrl,
          savedAt: now,
          recipeId: result.recipeId,
        });
      }
      // Non-retryable errors (404/422) drop the item rather than loop forever.
    } catch (err) {
      if (err instanceof NetworkError && item.attempts + 1 < MAX_ATTEMPTS) {
        const attempts = item.attempts + 1;
        remaining.push({
          ...item,
          attempts,
          nextAttemptAt: now + Math.min(BASE_BACKOFF_MS * 2 ** attempts, 3_600_000),
        });
      }
    }
  }
  await setQueue(remaining);
}
