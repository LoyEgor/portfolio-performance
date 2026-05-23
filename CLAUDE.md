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

Use CSS variables instead of hardcoding hex/Tailwind dark conditionals in JSX:
- `var(--text-primary)`, `var(--text-muted)`, `var(--text-muted-alt)`
- `var(--success)`, `var(--danger)`
- `var(--zone-up)`, `var(--zone-down)` — chart vs-benchmark fills
- `var(--accent-brand)` — hero accent
- `var(--weight-bar)`, `var(--ref-line)`, `var(--border-selected)`

Light + dark values live in `src/index.css` `:root` and `html.dark`.

## Tailwind dark mode

The app uses `html.dark .class { ... }` overrides in `index.css` rather than the
`dark:` modifier. Most stone/amber/emerald/red classes already have overrides.
If you introduce a new `bg-amber-NNN` / `border-X-NNN` and it doesn't look right
in dark mode, search `src/index.css` for the closest existing pattern and add
the override there — don't pollute JSX with `darkMode ? X : Y`.
