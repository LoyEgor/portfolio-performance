// CRITICAL: storage-adapter must be imported FIRST so window.storage exists
// before portfolio_tracker.jsx tries to use it.
import './storage-adapter';

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import PortfolioTracker from './portfolio_tracker.jsx';

// One-time bootstrap: if localStorage is empty AND there's a default-data.json in public/,
// import it before the app mounts. Subsequent loads ignore this file and use whatever's in
// localStorage (so user edits persist across reloads).
//
// To use: drop a backup JSON at `public/default-data.json` and refresh.
// To force re-import: open devtools → Application → Storage → clear localStorage, then reload.
async function bootstrapDefaultData() {
  const existing = await window.storage.get('portfolios:v8');
  if (existing?.value) return; // already have data, don't overwrite

  try {
    const res = await fetch('/default-data.json');
    if (!res.ok) return; // no file present — normal, app will start empty

    const raw = await res.json();

    // Portfolios: pass through (assume valid format from backup export).
    if (Array.isArray(raw.portfolios)) {
      await window.storage.set('portfolios:v8', JSON.stringify(raw.portfolios));
    }

    // Prices: unwrap any {data: {...}, importedAt} entries from older backup formats.
    if (raw.prices && typeof raw.prices === 'object') {
      const clean = {};
      for (const [ticker, val] of Object.entries(raw.prices)) {
        const priceMap = (val && typeof val === 'object' && val.data) ? val.data : val;
        if (priceMap && typeof priceMap === 'object') {
          clean[ticker.toUpperCase()] = priceMap;
        }
      }
      await window.storage.set('prices:v8', JSON.stringify(clean));
    }

    console.log('[bootstrap] Auto-imported default-data.json');
  } catch (err) {
    console.warn('[bootstrap] Could not auto-load default-data.json:', err.message);
  }
}

bootstrapDefaultData().then(() => {
  // No <React.StrictMode> on purpose — the app's useEffect does storage migration
  // and double-mount in dev would re-trigger it. Migration is idempotent (it checks
  // for existing v8 keys before doing anything) so this is just for clean dev logs.
  ReactDOM.createRoot(document.getElementById('root')).render(<PortfolioTracker />);
});
