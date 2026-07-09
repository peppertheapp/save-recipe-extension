import { DEFAULT_SETTINGS, type QueuedSave, type SaveHistoryEntry, type Settings } from './types';

/** Typed wrapper around chrome.storage. Settings live in sync; queue/history in local. */

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export function onSettingsChanged(cb: (changes: Partial<Settings>) => void): void {
  chrome.storage.sync.onChanged.addListener((changes) => {
    const patch: Record<string, unknown> = {};
    for (const [key, { newValue }] of Object.entries(changes)) patch[key] = newValue;
    cb(patch as Partial<Settings>);
  });
}

const QUEUE_KEY = 'saveQueue';
const HISTORY_KEY = 'saveHistory';
const HISTORY_LIMIT = 20;

export async function getQueue(): Promise<QueuedSave[]> {
  const { [QUEUE_KEY]: queue } = await chrome.storage.local.get(QUEUE_KEY);
  return (queue as QueuedSave[] | undefined) ?? [];
}

export async function setQueue(queue: QueuedSave[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function getHistory(): Promise<SaveHistoryEntry[]> {
  const { [HISTORY_KEY]: history } = await chrome.storage.local.get(HISTORY_KEY);
  return (history as SaveHistoryEntry[] | undefined) ?? [];
}

export async function pushHistory(entry: SaveHistoryEntry): Promise<void> {
  const history = await getHistory();
  history.unshift(entry);
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) });
}

// ---- Frontend-only mode (BACKEND_ENABLED = false): full recipes stored locally ----

const LOCAL_RECIPES_KEY = 'localRecipes';

export interface LocalRecipeEntry {
  recipe: import('./types').ExtractedRecipe;
  savedAt: number;
}

export async function getLocalRecipes(): Promise<Record<string, LocalRecipeEntry>> {
  const { [LOCAL_RECIPES_KEY]: recipes } = await chrome.storage.local.get(LOCAL_RECIPES_KEY);
  return (recipes as Record<string, LocalRecipeEntry> | undefined) ?? {};
}

export async function saveLocalRecipe(entry: LocalRecipeEntry): Promise<void> {
  const recipes = await getLocalRecipes();
  recipes[entry.recipe.sourceUrl] = entry;
  await chrome.storage.local.set({ [LOCAL_RECIPES_KEY]: recipes });
}
