/** A recipe extracted from a web page, normalized to Pepper's shape. */
export interface ExtractedRecipe {
  sourceUrl: string;
  title: string;
  description?: string;
  /** Largest available image from image/thumbnailUrl. */
  imageUrl?: string;
  author?: string;
  yield?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  ingredients: string[];
  instructions: string[];
  cuisine?: string[];
  category?: string[];
  keywords?: string[];
  nutrition?: Record<string, string>;
  ratingValue?: number;
  ratingCount?: number;
  extractionMethod: 'json-ld' | 'microdata' | 'server';
}

export interface SaveResult {
  status: 'saved' | 'duplicate' | 'queued' | 'error';
  recipeId?: string;
  profileUrl?: string;
  /** Human-readable reason, present when status === 'error'. */
  error?: string;
}

export interface VerifyResult {
  valid: boolean;
  displayName?: string;
  avatarUrl?: string;
  error?: string;
}

export interface Settings {
  userId: string | null;
  /** Phase 4: replace MyRecipes-network save buttons with Pepper's. */
  replaceCompetitorButtons: boolean;
  /** Hostnames where the floating button is hidden. */
  hiddenSites: string[];
  /** Persisted floating-button position (CSS right/bottom offsets in px). */
  buttonPosition: { right: number; bottom: number } | null;
  /** Override for dev/staging; empty string means the production default. */
  apiBaseUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  userId: null,
  replaceCompetitorButtons: true,
  hiddenSites: [],
  buttonPosition: null,
  apiBaseUrl: '',
};

export interface SaveHistoryEntry {
  title: string;
  sourceUrl: string;
  savedAt: number;
  recipeId?: string;
}

/** A save that failed (e.g. offline) and is waiting for retry. */
export interface QueuedSave {
  recipe: ExtractedRecipe;
  userId: string;
  attempts: number;
  nextAttemptAt: number;
  enqueuedAt: number;
}

// ---- Messages between content script / popup and the service worker ----

export type Message =
  | { type: 'DETECTION_CHANGED'; hasRecipe: boolean }
  | { type: 'SAVE_RECIPE'; recipe: ExtractedRecipe }
  | { type: 'VERIFY_USER'; userId: string };

export type MessageResponse<M extends Message> = M extends { type: 'SAVE_RECIPE' }
  ? SaveResult
  : M extends { type: 'VERIFY_USER' }
    ? VerifyResult
    : void;
