/**
 * Master switch for the Pepper backend integration.
 *
 * false (current): frontend-only mode. The secret code is stored locally without
 * verification, and saved recipes are kept in chrome.storage.local (visible in
 * the popup's Recent saves, deduped by URL) ready to sync later.
 *
 * true: the popup verifies the code via GET /v1/extension/verify and saves POST
 * to /v1/extension/import (see src/shared/api.ts). Flip this once the endpoints
 * exist in pepper-backend.
 */
export const BACKEND_ENABLED = false;
