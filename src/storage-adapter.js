// Storage adapter: implements the same `window.storage` API surface as the Claude artifact
// runtime, backed by the browser's localStorage.
//
// portfolio_tracker.jsx expects this exact API and will silently no-op if it's missing:
//   window.storage.get(key)        → Promise<{value: string} | null>
//   window.storage.set(key, value) → Promise<void>
//   window.storage.delete(key)     → Promise<void>
//   window.storage.list(prefix)    → Promise<{keys: string[]} | null>
//
// All values are strings (the component does its own JSON.stringify/parse).
//
// localStorage limit is ~5–10 MB depending on the browser. For typical use (a few hundred
// tickers × monthly closes) this is plenty. If you exceed it, swap this file for an
// IndexedDB-backed implementation — the API surface is intentionally minimal so a swap is easy.

if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    async get(key) {
      try {
        const value = window.localStorage.getItem(key);
        return value !== null ? { value } : null;
      } catch (err) {
        console.warn('[storage] get failed', key, err);
        return null;
      }
    },

    async set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (err) {
        // Most likely QuotaExceededError. Surface it loudly so the user notices.
        console.error('[storage] set failed (likely quota exceeded)', key, err);
        throw err;
      }
    },

    async delete(key) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        console.warn('[storage] delete failed', key, err);
      }
    },

    async list(prefix = '') {
      try {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        return { keys };
      } catch (err) {
        console.warn('[storage] list failed', prefix, err);
        return { keys: [] };
      }
    },
  };
}
