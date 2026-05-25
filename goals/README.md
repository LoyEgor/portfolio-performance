# Goals

Goal specifications consumed by Claude Code's [`/goal`](https://code.claude.com/docs/en/goal)
command. Each file in this folder is a multi-turn instruction set that
maintains the investor database and price data — `/goal` keeps Claude iterating
across turns until each spec's stated completion condition holds.

All goals **read/write `public/data/*`** (the read-only-from-UI investor base)
or `public/default-data.json` (the user-config layer — only via the app's Save
button in normal flow; goals may touch it for cleanup like removing a deleted
investor's id from `selectedInvestors`).

## Architecture recap

- **Read-only investor base** — `public/data/*` — maintained by goals only.
  - `investors-index.json` — 80-investor catalog (id, name, AUM, link, tags, history range)
  - `investors/<id>.json` — per-investor holdings + history
  - `prices/<YYYY>.json` — ticker prices, split by year (range in `meta.priceYears`)
  - `meta.json` — global contract for the base:
    - `latestQuarter` — every investor has data through this quarter
    - `oldestHistoryAsOf` — earliest `asOf` across the base (depth target for `INVESTORS-ADD`)
    - `priceYears: {from, to}` — range of `prices/<YYYY>.json` files on disk
    - `activityWindowQuarters` — rolling window for `shares` fields
    - `lastBackfillAt`, `lastStocksUpdateAt` — diagnostic timestamps
- **User config** — `public/default-data.json` — `selectedInvestors[]`, color/visibility
  customization, myPortfolio. Goals NEVER write here (except `scripts/remove-investor.mjs`
  which prunes deleted investor IDs from the selection).
- **App source code** — `src/portfolio_tracker.jsx`, `src/main.jsx`, etc. Goals NEVER touch.

## Goals

| File | Trigger | Purpose |
|---|---|---|
| `STOCKS-UPDATE.md` | Monthly | Refresh `prices/<YYYY>.json` files to cover the latest completed month for every referenced ticker. |
| `INVESTORS-BACKFILL.md` | Quarterly (no params) / on demand (`--years=N`) | Refresh investor holdings + history. Without parameters → catches everyone up to the latest quarter on DataRoma (this is the "quarterly update" use case). With `--years=N` → fetches up to N years back per investor. Idempotent: only fetches what's missing unless `--force`. |
| `INVESTORS-ADD.md` | On demand | Add a single investor by name. Searches sources by priority, picks the most popular match, fetches history up to `meta.latestQuarter` (not beyond — keeps the base aligned). |

## Source priority

When fetching investor data, try in this order. Stop at the first source that
returns valid data.

1. [Dataroma](https://www.dataroma.com/)
2. [13F.info](https://13f.info/)
3. [stockzoa.com](https://stockzoa.com/)
4. [valuesider.com](https://valuesider.com/)
5. [GuruFocus](https://www.gurufocus.com/)
6. [WhaleWisdom](https://whalewisdom.com/)
7. [HedgeFollow](https://hedgefollow.com/)
8. [StockCircle](https://stockcircle.com/)

Record the chosen source in `investors-index.json[id].primarySource` so
subsequent updates use the same one (stability over re-discovery).

## Global hard constraints (apply to every goal)

- **NEVER** edit:
  - `src/*`, `vite.config.js`, `package.json`, `tailwind.config.js`, `index.html`
  - `public/default-data.backup-*.json` (app-managed snapshots)
- **NEVER** push to remote, **NEVER** open PRs, **NEVER** create commits without explicit user permission.
- Always write a `/tmp/<goal-name>.pre-run.tar` snapshot of `public/data/` before the first mutation, so failed runs can be inspected/rolled back.
- Use polite pacing for outbound HTTP (1-2s between requests to the **same domain**) to avoid rate-limits.
- Retry with exponential backoff on 429/503 (3 tries max). Skip with logged warning on persistent failure.

## Concurrency

Goals MAY process up to **3 work-units concurrently**, but **only across different
source domains**. Same-domain requests stay strictly serial with 1-2s pacing.

Concrete: if processing 76 investors and source distribution is 60 DataRoma /
10 13F.info / 6 Web Archive, the LLM can run 3 fetches in parallel — one per
source. It MUST NOT issue 3 parallel DataRoma requests; that breaks the
pacing contract. When all 3 slots are DataRoma-bound, fall back to serial.

This is implementable inside one Claude turn (parallel WebFetch tool calls)
provided each call targets a distinct host. Shared writes (`investors-index.json`,
`meta.json`) happen only **after** all concurrent fetches in the batch
complete — never partially mid-batch.

## Ticker hygiene (applies to every goal that writes holdings)

Any goal that produces `{ ticker, weight, ... }` entries in `holdings[]` or
`history[].holdings[]` MUST follow these rules. Verify scripts enforce them.

### 1. Dual-class separator: DOT, not DASH

13F.info and SEC EDGAR return `BRK-B`, `BRK-A`, `BF-B`, `BIO-B`, etc.
DataRoma returns `BRK.B`, `BRK.A`, `BF.B`. **Our base uses the DOT form** —
prices in `public/data/prices/<YYYY>.json` are keyed with DOT, and the React
app's `normalizeTicker` strips suffixes from DOT form.

Before writing, normalize every ticker matching `^([A-Z]+)-([A-Z])$` (root +
single-letter class) to `\1.\2`. Example: `BRK-B` → `BRK.B`, `BRK-A` → `BRK.A`.

### 2. No `-OLD` / `Q-OLD` / `MQ-OLD` suffix tickers

Sources sometimes return parser-internal markers like `ANSS-OLD`, `CFLT-OLD`,
`TWTR-OLD`, `DNMRQ-OLD`, `Y-OLD` for positions that had a corporate action
(rename, M&A, delisting). These are scratch-pad symbols and **must not enter
the data**.

When you encounter a ticker matching `-OLD$` (or `Q-OLD$` for bankruptcies):
- Drop the position entirely from that snapshot.
- Log to `/tmp/<goal>-log.txt`: `(investor, quarter, dropped-OLD-ticker)`.
- Do NOT try to map to the "new" ticker — that's source-fidelity territory,
  out of scope here.

### 3. No cross-listing switches for established positions

Companies dual-listed in US + Canada (Brookfield: `BN` + `BN.TO`; Brookfield
Asset Mgmt: `BAM` + `BAM.TO`; Canadian Pacific: `CP` + `CP.TO`; Enbridge:
`ENB` + `ENB.TO`; Franco-Nevada: `FNV` + `FNV.TO`; Imperial Oil: `IMO` +
`IMO.TO`; Nutrien: `NTR` + `NTR.TO`; Wheaton Precious: `WPM` + `WPM.TO`;
Ovintiv: `OVV` + `OVV.TO`; Suncor: `SU` + `SU.TO`; TC Energy: `TRP` +
`TRP.TO`; Manulife: `MFC` + `MFC.TO`; Royal Bank: `RY` + `RY.TO`; etc.)
have different price series. Switching ticker forms invalidates historical
price coverage.

**Rule:** if an investor's existing file already has a position under the US
ticker (`BN`, `CP`, `ENB`, …), and a fresh fetch tries to record the same
company under the Canadian (`.TO`) ticker, **preserve the US ticker**. The
same applies in reverse: don't switch from `.TO` to US for a fund that has
established positions on the Canadian listing.

For investors **new** to the base where no prior ticker exists for the
company, accept whatever the source returned (US-first preferred when both
forms appear in the source).

Same logic applies to `.L` (London), `.MX` (Mexico), `.SW` (Swiss), `.DE`
(Germany), `.MI` (Milan) suffixes — never switch an established US-listing
position to a foreign-exchange variant. Foreign-only positions (e.g.
`FLTR.L` for a UK manager who never had US listing) stay as-is.

### 4. Verify enforcement

Each goal's verify script MUST fail (exit 1) if any holding violates these
rules. Pattern checks:
- `re.match(r'^[A-Z]+-[A-Z]$', ticker)` → dash-separator violation
- `re.search(r'-OLD$', ticker)` → leaked parser marker
- Cross-listing regression is harder to enforce mechanically — verify against
  the pre-run snapshot: any ticker that changed form between snapshot and
  result is a flag (informational warning, not hard failure, since some
  changes are legitimate corporate actions).

## Running — the `/goal` command

These goal files are designed to be driven by Claude Code's built-in **`/goal`**
slash command (introduced in Claude Code 2.1.139, May 2026 — see
[code.claude.com/docs/en/goal](https://code.claude.com/docs/en/goal)).

`/goal` is what makes a "goal" different from a single prompt: instead of one
turn that may or may not finish the work, Claude keeps working across multiple
turns — running tools, parsing output, fixing what it broke — until a **completion
condition** is met. A small fast model between turns checks whether the condition
holds; if not, Claude takes another turn. The harness tracks elapsed time, turns,
and tokens. Runs can last hours or days.

A `/goal` invocation has two parts:
1. **What to do** — usually "Follow goals/<FILE>.md with these params".
2. **When you're done** — a verifiable completion condition (typically: a verify
   script exits 0, or specific files exist with expected shape).

The `.md` files in this folder are the **instructions**. `/goal` is the **driver**.

### Always interactive (`claude` + `/goal`)

> **Use interactive mode.** `claude -p "/goal …"` runs headless and hides every
> tool call until the very end — for a multi-hour bootstrap that means staring
> at a frozen terminal with no idea whether progress is happening. There is **no
> speed benefit** to headless: the same loop runs, the same tokens are spent.
> The only thing you trade away is visibility.
>
> The pattern is always: open a session, then type `/goal …` inside it.

Every session passes `--dangerously-skip-permissions` so the goal doesn't block
on permission prompts for routine WebFetch / Bash / file writes.

```bash
cd /Volumes/Work/Projects/portfolio-performance
claude --dangerously-skip-permissions
```

Then inside the session:

```
/goal Follow goals/<FILE>.md [with <params>].
```

That's it — no "Done when …" needed. Each spec file ends with its own
**Done condition** section (verify script exits 0 + a couple of structural
checks). `/goal` reads the spec each turn and uses that section as the
completion condition automatically. Only add an explicit "Done when …"
override if you want to change the condition for one specific run (e.g.
"Done when only buffett.json is updated, ignore everyone else").

You'll see every tool call, per-turn status, elapsed time, and you can Ctrl+C
at any moment without losing data (`/goal` is idempotent — resuming continues
where it stopped).

### Command catalog

All commands run **inside `claude --dangerously-skip-permissions`** (open the
session first). Each spec file's "Done condition" section is the implicit
completion check — don't paste it into the command.

| Use case | Command |
|---|---|
| Stocks update (monthly) | `/goal Follow goals/STOCKS-UPDATE.md.` |
| Quarterly backfill (no-op if nothing new) | `/goal Follow goals/INVESTORS-BACKFILL.md.` |
| First-time bootstrap / extend history | `/goal Follow goals/INVESTORS-BACKFILL.md with --years=5.` |
| Try on one investor first | `/goal Follow goals/INVESTORS-BACKFILL.md with --investors=buffett --years=5.` |
| Force re-fetch one investor | `/goal Follow goals/INVESTORS-BACKFILL.md with --investors=buffett --force --years=5.` |
| Add a new investor | `/goal Follow goals/INVESTORS-ADD.md with --name='Bill Ackman'.` |
| Add with source hint | `/goal Follow goals/INVESTORS-ADD.md with --name='Bill Ackman' --source-hint=stockzoa/pershing-square.` |

13F deadlines that gate `INVESTORS-BACKFILL.md` (no-params form): **May 15 /
Aug 14 / Nov 14 / Feb 14**. Run it the day after.

### Remove an investor

Not a goal — a plain Node script (deletion is mechanical, doesn't need an LLM):

```bash
node scripts/remove-investor.mjs <investor-id>
# Example:
node scripts/remove-investor.mjs ackman
```

The script removes the investor's file, prunes the index entry, and cleans up
any references in `public/default-data.json` (selectedInvestors, customization).
Prices stay in `prices/<YYYY>.json` — they may be referenced by other investors
and re-removing them is a separate concern (run STOCKS-UPDATE to GC orphaned
tickers if you care).

## Typical workflows

All inside `claude --dangerously-skip-permissions`.

**Quarterly cycle (every 3 months after 13F deadline):**

```
/goal Follow goals/INVESTORS-BACKFILL.md.
```

When that finishes, in the same session:

```
/goal Follow goals/STOCKS-UPDATE.md.
```

**Monthly cycle (between quarterly refreshes):**

```
/goal Follow goals/STOCKS-UPDATE.md.
```

**Adding a brand-new investor:**

```
/goal Follow goals/INVESTORS-ADD.md with --name='<NAME>'.
```

Then (same session) to fetch any new tickers:

```
/goal Follow goals/STOCKS-UPDATE.md.
```

### Headless mode (only for cron / scheduled automation)

For non-interactive scheduled runs (e.g. a cron-triggered monthly STOCKS-UPDATE
that writes to a log and emails you on failure), `-p` works:

```bash
claude -p --dangerously-skip-permissions --verbose "/goal Follow goals/STOCKS-UPDATE.md." > /tmp/stocks-update.log 2>&1
```

The `--verbose` flag streams per-turn output to stdout (without it, the terminal
sits silent until the run finishes hours later — that's the trap that prompted
the "always interactive" rule above). Reserve this form for automation; for
anything you launch by hand, use the interactive pattern.

### Watching a long run

Long `/goal` invocations (the `--years=max` bootstrap can run hours) print
incremental progress. Useful side commands while one is running:

```bash
# In another terminal — tail the goal-specific log
tail -f /tmp/investors-backfill-log.txt

# Or check the harness's per-turn JSONL
ls -lh /private/tmp/claude-*/.../*.output
```

`/goal` itself reports elapsed time, turns, and tokens in its periodic status
lines — you can leave it overnight without losing visibility.

## Logging

Each goal writes a structured log to `/tmp/<goal-name>-log.txt` with:
- start/end timestamps
- per-investor / per-ticker status (OK / SKIPPED / FAILED with reason)
- total network requests, runtime, bytes downloaded
- list of items needing user attention (e.g. >5pp diff on add-investor)

After every run, print the log path so the user can inspect.
