# Portfolio Performance — project conventions

## Updating any portfolio's holdings (quarterly)

**Rule:** when the user says "update My Portfolio" / "update Buffett" / etc. with a
new snapshot, it ALWAYS means a quarterly chain-link update. Never overwrite
`holdings` in place.

The correct steps:

1. Take the CURRENT `holdings` from the file.
2. Push it into the `history` array with `asOf` = last day of the quarter it
   represented. By default that's the quarter ending **before** the new snapshot
   you're about to record. Example: if the user is giving you Q1 2026 data,
   push current into history as `asOf: "2025-12-31"` (Q4 2025).
3. Replace `holdings` with the new snapshot. Its implicit `asOf` is one
   quarter later than the most recent `history.asOf` (chain-link logic in
   `src/portfolio_tracker.jsx` → `computeSeries` derives this automatically).
4. If a subtitle has the format `"... QN YYYY (Kq chain-linked)"`, bump it
   (`Q1 2026 (5q chain-linked)` → `Q2 2026 (6q chain-linked)` on the next round).

This applies to ALL portfolios with quarter-by-quarter snapshots: gurus,
DataRoma Top 20, and `myPortfolio`. Treat `myPortfolio` exactly like a guru in
this respect — every update pushes the previous quarter into history.

The user explicitly does NOT want to be reminded of this each time. Read the
existing state, do the push, write the new state.

When the user posts a broker screenshot for `myPortfolio`:
- Skip ETFs (`ARCA`, `LSEETF`, `IBIS2`, `SBF` suffixes, or anything explicitly an ETF) and cash entries — myPortfolio is equities-only.
- Compute weights = `market_value / total_equity_MV × 100`, rounded to 2 decimals.
- Save as `{ ticker, weight }`. `shares` is an optional field on the holding
  schema — goals (INVESTORS-BACKFILL) populate it for gurus inside the
  `meta.activityWindowQuarters` rolling window so the UI can show real trading
  activity. For `myPortfolio` it's left absent (we don't track share counts
  for the user's own positions).

## Source of truth & save behaviour

- `public/default-data.json` is the canonical data file (v9 format on this branch).
- No localStorage. App reloads from `default-data.json` on every page refresh.
- Save button writes in-memory state to `default-data.json` via Vite dev-plugin endpoint.
- Goal scripts write directly to JSON files; Save button is for user-driven changes.

## Files to never touch from a Goal / agent

- `public/default-data.backup-{1,2,3}.json` — app-managed snapshots, not version control.
- The `color` field on any portfolio — user-curated.
- The order of portfolios in `selectedInvestors` or any portfolios array — user-curated.

## Theme tokens

The project has a dual color system. **They must not mix in new components.**

1. **Legacy Tailwind color classes** (`bg-stone-XXX`, `text-amber-XXX`, etc.)
   exist throughout older code (~166 references in `src/portfolio_tracker.jsx`).
   Each requires a matching `html.dark .bg-stone-XXX {}` override in
   `src/index.css`. Forgetting one → component looks broken in dark mode. This
   is a leaky abstraction we tolerate for old code, **NOT a pattern to extend**.

2. **CSS tokens** in `src/index.css` `:root` / `html.dark` — auto-switch with
   theme. This is the correct way going forward.

### Rule for new components

**Use only `var(--…)` tokens for colors.** Do NOT add new `bg-stone-XXX`,
`text-amber-XXX`, `border-emerald-XXX`, `hover:bg-stone-NNN` to JSX written
from scratch. Inline style is acceptable:

```jsx
<div style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
```

or via a dedicated `.foo { background: var(--bg-card); }` class in `index.css`.

If the token you need doesn't exist — add it to BOTH `:root` and `html.dark`,
then use it. Never inline a hex in JSX, never branch on `darkMode ? X : Y`.

### Token reference (full set in `src/index.css`)

**Surfaces:** `--bg-app`, `--bg-card`, `--bg-card-elevated`, `--bg-panel`,
`--bg-input`, `--row-stripe`, `--row-hover`, `--row-selected`

**Borders:** `--border-subtle`, `--border-strong`, `--border-focus`,
`--border-selected`

**Text** (decreasing intensity): `--text-primary`, `--text-secondary`,
`--text-tertiary`, `--text-muted`, `--text-muted-alt`

**Accent:** `--accent-brand` (hero), `--accent-on-bg` (interactive)

**Status** — paired strong/mild: `--success`, `--success-strong`,
`--success-mild`, `--danger`, `--danger-strong`, `--danger-mild`,
`--neutral-mild`

**Magnitude** for return/diff cells colored by `|Δ|`:
- `--magnitude-low` — `|Δ| < 3%`, grey
- `--magnitude-mid` — `3-20%`, regular weight, use `--success`/`--danger`
- `--magnitude-high` — `20-40%`, bold, use `--success-strong`/`--danger-strong`
- `--magnitude-extreme` — `≥40%`, black weight, same colors as `high`

**Chart-specific:** `--zone-up`, `--zone-down`, `--ref-line`, `--weight-bar`

### Migrating old code

Don't bulk-rewrite. When you touch a section of old code, port its colors to
tokens opportunistically. Eventually the legacy Tailwind color classes shrink
and we can drop the `html.dark .X {}` override block en masse.
