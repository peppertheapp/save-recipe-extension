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
  /** 'ai' when instructions were generated on-device from the ingredients. */
  instructionsSource?: 'extracted' | 'ai';
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
  /** The Pepper "secret code" the user pastes from the app (their user id). */
  userId: string | null;
  /** Persisted floating-button position (CSS right/bottom offsets in px). */
  buttonPosition: { right: number; bottom: number } | null;
  /** Dev/staging override, set via console only; empty string = production. */
  apiBaseUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  userId: null,
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
