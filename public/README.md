# public/ directory

Files placed here are served at the root URL by Vite (e.g., `public/foo.json` → `http://localhost:5173/foo.json`).

## Auto-loading default data

To auto-import a backup on first run, drop your JSON here and rename it to:

```
public/default-data.json
```

Behavior:
- **First load** (localStorage empty): `src/main.jsx` fetches `/default-data.json`, parses it, writes to localStorage, then the app mounts with the data already there.
- **Subsequent loads**: file is ignored. App reads from localStorage so your edits persist.
- **No file present**: app starts with the hardcoded defaults (just "My Portfolio" + VOO + VT seed).

## Re-importing after edits

Once you've made changes in-app, the auto-bootstrap won't overwrite them. To force re-import the file:

1. Open browser devtools (F12)
2. Application tab → Storage → Local Storage → `http://localhost:5173`
3. Right-click → Clear
4. Reload the page

Or just use the in-app **Backup → Restore from backup file** button to manually import any time.

## What format does default-data.json need?

Same as the backup export format:

```json
{
  "version": "v8",
  "exportedAt": "2026-04-25T...",
  "portfolios": [...],
  "prices": {
    "AAPL": { "2026-04-01": 254.08, ... },
    ...
  }
}
```

The bootstrap parser is lenient — accepts older v5/v6/v7 wrapped price formats too (`{TICKER: {data: {date: price}, importedAt: ...}}`).
