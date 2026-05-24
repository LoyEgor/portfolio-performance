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

- `public/default-data.json` is the canonical user-config file (v9 format).
- The read-only investor base lives in `public/data/*` (`investors-index.json`,
  `investors/<id>.json`, `prices/<YYYY>.json`, `meta.json`) and is maintained
  by goals. Prices are split by year; the range is recorded in
  `meta.priceYears = { from, to }` and the React loader merges them at runtime.
- No localStorage. App reloads from `default-data.json` and `public/data/*` on every page refresh.
- Save button writes in-memory state to `default-data.json` via Vite dev-plugin endpoint.
- Goals (run via `/goal` — see below) write directly to `public/data/*` JSON files; Save button is for user-driven changes.

## Files to never touch from a goal / agent

- `public/default-data.backup-{1,2,3}.json` — app-managed snapshots, not version control.
- The `color` field on any portfolio — user-curated.
- The order of portfolios in `selectedInvestors` or any portfolios array — user-curated.

## No legacy, no migration shims

This app is in **active development**, used by one person, with no external
deployments. There is no v8/v7/etc. install in the wild to worry about. Treat
the current data shape as the **only** shape.

- Don't add backwards-compatibility branches (`if (cfg.version === 'v8') …`,
  `if (!meta.priceYears) fetch(legacy)`, etc.). When the shape changes,
  change the migration script + the code + the goal specs in one go.
- Don't keep "fallback to old path" logic around for safety. Missing/malformed
  data should `throw` so the agent that touched the data layer notices on
  the next reload. Silent fallbacks hide drift between the docs, the data,
  and the code.
- Don't preserve deprecated fields "just in case". Delete them; the next
  Save round-trip cleans the file.
- Migration scripts (`scripts/*.mjs`) exist for one-time transforms and are
  removed once the corresponding shape change has been everywhere applied —
  they are not a permanent compatibility layer.

If you're an AI agent reading this and you find yourself reaching for a
defensive fallback because "what if the data is in the old format" — stop.
The data was migrated by the same agent (or its predecessor) that's now
reading it. If it's in the wrong format, that's a bug to fix at the source,
not a case to handle.

## Goals are run via Claude Code's `/goal` command

This project's maintenance work — fetching DataRoma snapshots, refreshing
prices, adding new investors — is split into a small set of **goal
specifications** (`.md` files) under `goals/`. Each one is driven by Claude
Code's built-in **`/goal`** slash command (introduced in Claude Code 2.1.139,
May 2026 — [docs](https://code.claude.com/docs/en/goal)).

`/goal` loops over multiple Claude turns until a verifiable completion
condition holds. A small fast model checks the condition between turns; if
it doesn't hold, Claude takes another turn. The harness tracks elapsed time,
turns, and tokens. Runs can last hours or days.

Why this matters for any LLM/agent working in this repo:

- **Don't treat goal files as one-shot prompts.** They're written assuming a
  multi-turn loop with a completion check. A single one-shot prompt won't
  iterate to finish — it'll do one turn and stop. Use `/goal` so the harness
  drives convergence.
- **Don't invent your own "execute to done" wording.** The `/goal` command
  already provides the loop. Goal files just describe *what* to do and *when
  it's done*.
- **Don't make goal files mutually dependent on conversation context.** The
  harness passes the goal file's contents verbatim each turn — they must be
  self-contained.

### Always interactive — never headless `-p` by default

Default invocation is **interactive**:

```bash
cd /Volumes/Work/Projects/portfolio-performance
claude --dangerously-skip-permissions
```

Then inside the session:

```
/goal Follow goals/<FILE>.md with <params>.
```

**No "Done when …" needed.** The spec file's "Done condition" section is the
completion check — `/goal` reads it each turn. Only add an explicit
"Done when …" if you want to override the spec for a one-off run (e.g. a
narrower scope for testing).

`claude -p "/goal …"` (headless) runs the same loop but **hides all tool calls
until the very end** — a multi-hour bootstrap looks like a frozen terminal. There
is no speed advantage to headless; the only thing it trades is visibility. Reserve
it for cron/automation, never for a run you launch by hand. If you must use
headless, pair it with `--verbose` so per-turn output streams to stdout.

See `goals/README.md` for the command catalog (one row per use case).

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

**Use only `var(--…)` tokens for colors.** This is a hard rule — every new
inline hex in JSX is a bug to be fixed. Same applies to font sizes (`text-body`,
`text-micro`, etc. — see `src/index.css`) and font weights.

Do NOT add new `bg-stone-XXX`, `text-amber-XXX`, `border-emerald-XXX`,
`hover:bg-stone-NNN`, `text-[12px]`, `font-bold` (with raw value), or any
inline `style={{ color: '#…' }}` / `style={{ fontSize: 12 }}` to JSX written
from scratch. The whole point of the token layer is one source of truth:
when the user adjusts the palette or the scale, every component updates
automatically. A single hardcoded hex breaks that contract.

Inline style with a token reference is acceptable:

```jsx
<div style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
```

or via a dedicated `.foo { background: var(--bg-card); }` class in `index.css`.

If the token you need doesn't exist — add it to BOTH `:root` and `html.dark`,
then use it. Never inline a hex in JSX, never branch on `darkMode ? X : Y`.

### Picking a color for a portfolio / investor / ETF chart line

Use the existing helper `getInvestorColor(id, activePortfolio, customization)`
(in `src/portfolio_tracker.jsx`). It returns the user's saved override if any,
the active portfolio's color if not, otherwise a deterministic pick from the
`PALETTE` constant hashed by id. **Never write `color: '#1a1815'` (or any other
literal) as a default fallback** — that breaks the "stable color per entity"
invariant the chart and matrix dots both rely on. The helper is the only
correct way to derive a default color across the app.

Examples:

```jsx
// In a useMemo that hydrates shell portfolio objects from an index entry:
return { id, name, kind: 'etf', color: getInvestorColor(id, null, null), … };

// When the user toggles a new entity on from a matrix:
setPortfolios(prev => [...prev, { id, color: getInvestorColor(id, null, null), … }]);
```

### Font sizes / weights

Same rule — use the token utility classes (`text-body`, `text-micro`,
`font-medium`, etc., defined in `src/index.css`) instead of `text-[12px]`,
`font-bold`, or inline `style={{ fontSize: 11 }}`. If a size you need is
missing, add it as a token in `src/index.css` and reference the class.

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
