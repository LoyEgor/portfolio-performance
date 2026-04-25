# Setup steps (copy-paste friendly)

## Prerequisites

Node.js 18+ and npm. Check with:
```bash
node --version && npm --version
```

## Step 1 — Files to place

The user gives you these files. Place them as shown:

```
portfolio-comparator/
├── README.md                       (provided)
├── SETUP.md                        (this file)
├── package.json                    (provided)
├── vite.config.js                  (provided)
├── tailwind.config.js              (provided)
├── postcss.config.js               (provided)
├── index.html                      (provided)
├── .gitignore                      (provided)
└── src/
    ├── main.jsx                    (provided)
    ├── storage-adapter.js          (provided)
    ├── index.css                   (provided)
    └── portfolio_tracker.jsx       ← user gives separately, place here
```

## Step 2 — Install and run

```bash
cd portfolio-comparator
npm install
npm run dev
```

Browser should open at `http://localhost:5173` automatically (configured in `vite.config.js`).
If not, open it manually.

## Step 3 — Verify the app loads

You should see:
- "Performance, side by side." headline
- A chart area (probably empty — "No data to chart yet")
- Default portfolios in the right column: "My Portfolio"
- VOO and VT only appear after you load the backup

## Step 4 — Load the user's backup

**Option A — auto-load on first run (recommended):**

Drop the user's JSON at `public/default-data.json`. On first launch (when localStorage is empty),
`src/main.jsx` fetches it and writes to storage before the app mounts. Subsequent reloads use
whatever's in localStorage so user edits persist.

To re-import after edits: open devtools → Application → Storage → clear localStorage, then reload.

**Option B — manual import via UI (anytime):**

1. Click **Backup** button (top right)
2. Click **Restore from backup file**
3. Select the user's JSON (e.g. `portfolio-comparator-2026-04-25.json`)
4. Preview shows portfolio + ticker counts
5. Click **Confirm restore**
6. Progress bar → modal closes when done

After either path: chart should populate, all portfolios visible in legend.

## Step 5 — Optional production build

```bash
npm run build
npm run preview
```

Static files end up in `dist/`. Deploy to any static host (Netlify, Vercel, GitHub Pages, S3).

## Troubleshooting

**"window.storage is not defined"** — `src/main.jsx` must import `./storage-adapter` BEFORE
importing the component. Check the import order.

**"Module not found: 'lucide-react'"** — re-run `npm install`. The package list:
react, react-dom, recharts, lucide-react (runtime); vite, @vitejs/plugin-react, tailwindcss,
postcss, autoprefixer (dev).

**Tailwind classes have no effect** — check `tailwind.config.js` `content` paths point to your
actual JSX files. The single-file component has all classes inline so just `./src/**/*.{js,jsx}`
is enough.

**Backup restore fails** — check browser console. Most likely the JSON is malformed or
localStorage quota is full. Clear the v5/v6/v7 keys if migrating from an old version.

**Chart shows nothing after import** — open Data Manager (right column). Tickers without data
appear at top with amber dot. The user's backup should include all needed prices, but if a
portfolio holding has no matching price entry, that portfolio's line won't render.
