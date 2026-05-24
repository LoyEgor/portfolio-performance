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
  - `prices.json` — all ticker prices
  - `meta.json` — global `latestQuarter` and last-fetched timestamp
- **User config** — `public/default-data.json` — `selectedInvestors[]`, color/visibility
  customization, myPortfolio. Goals NEVER write here (except `scripts/remove-investor.mjs`
  which prunes deleted investor IDs from the selection).
- **App source code** — `src/portfolio_tracker.jsx`, `src/main.jsx`, etc. Goals NEVER touch.

## Goals

| File | Trigger | Purpose |
|---|---|---|
| `STOCKS-UPDATE.md` | Monthly | Refresh `prices.json` to cover the latest completed month for every referenced ticker. |
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
- Use polite pacing for outbound HTTP (1-2s between requests to the same domain) to avoid rate-limits.
- Retry with exponential backoff on 429/503 (3 tries max). Skip with logged warning on persistent failure.

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
/goal <instructions referencing one of the goal files> Done when <condition>.
```

You'll see every tool call, per-turn status, elapsed time, and you can Ctrl+C
at any moment without losing data (`/goal` is idempotent — resuming continues
where it stopped).

### Stocks update (monthly, between quarterly refreshes)

Inside `claude --dangerously-skip-permissions`:

```
/goal Follow goals/STOCKS-UPDATE.md. Done when /tmp/verify-stocks.py exits 0 — every referenced ticker has YYYY-MM-01 keys up through the first-of-month of the prior calendar month.
```

### Investors backfill — incremental quarterly update (every ~3 months)

Run after the 13F deadlines: **May 15 / Aug 14 / Nov 14 / Feb 14**.

```
/goal Follow goals/INVESTORS-BACKFILL.md (no params — incremental quarterly). Done when /tmp/verify-backfill.py exits 0 AND meta.json.latestQuarter equals the most recent 13F-released quarter for today's date.
```

### Investors backfill — extend history backward

Test on one investor first:

```
/goal Follow goals/INVESTORS-BACKFILL.md with --investors=buffett --years=max. Done when public/data/investors/buffett.json has been rewritten with the full available history from DataRoma (~5 years, 16+ quarterly snapshots) AND /tmp/verify-backfill.py exits 0 for buffett.
```

Then go big (the overnight bootstrap):

```
/goal Follow goals/INVESTORS-BACKFILL.md with --years=max. Done when /tmp/verify-backfill.py exits 0 AND every investor file has history covering 5 years (16+ quarterly snapshots) — or, where the source genuinely has less, the maximum the source provides.
```

Force re-fetch a specific investor:

```
/goal Follow goals/INVESTORS-BACKFILL.md with --investors=buffett --force --years=max. Done when public/data/investors/buffett.json has been rewritten and /tmp/verify-backfill.py exits 0 for that id.
```

### Add a new investor

```
/goal Follow goals/INVESTORS-ADD.md with --name='Bill Ackman'. Done when investors-index.json contains a new entry for this person AND public/data/investors/<id>.json exists with non-empty holdings and history AND /tmp/verify-add.py exits 0.
```

With a source hint (when the popular default isn't who you want):

```
/goal Follow goals/INVESTORS-ADD.md with --name='Bill Ackman' --source-hint=stockzoa/pershing-square. Done when the new investor file's _provenance.primarySource matches the hint AND /tmp/verify-add.py exits 0.
```

### Remove an investor

Not a goal — a plain Node script (deletion is mechanical, doesn't need an LLM):

```bash
node scripts/remove-investor.mjs <investor-id>
# Example:
node scripts/remove-investor.mjs ackman
```

The script removes the investor's file, prunes the index entry, and cleans up
any references in `public/default-data.json` (selectedInvestors, customization).
Prices stay in `prices.json` — they may be referenced by other investors and
re-removing them is a separate concern (run STOCKS-UPDATE to GC orphaned tickers
if you care).

## Typical workflows

All inside `claude --dangerously-skip-permissions`.

**Quarterly cycle (every 3 months after 13F deadline):**

```
/goal Follow goals/INVESTORS-BACKFILL.md. Done when /tmp/verify-backfill.py exits 0 AND meta.json.latestQuarter equals the most recently released 13F quarter.
```

When that finishes, in the same session:

```
/goal Follow goals/STOCKS-UPDATE.md. Done when /tmp/verify-stocks.py exits 0.
```

**Monthly cycle (between quarterly refreshes):**

```
/goal Follow goals/STOCKS-UPDATE.md. Done when /tmp/verify-stocks.py exits 0.
```

**Adding a brand-new investor:**

```
/goal Follow goals/INVESTORS-ADD.md with --name='<NAME>'. Done when /tmp/verify-add.py exits 0.
```

Then (same session) to fetch any new tickers:

```
/goal Follow goals/STOCKS-UPDATE.md. Done when /tmp/verify-stocks.py exits 0.
```

### Headless mode (only for cron / scheduled automation)

For non-interactive scheduled runs (e.g. a cron-triggered monthly STOCKS-UPDATE
that writes to a log and emails you on failure), `-p` works:

```bash
claude -p --dangerously-skip-permissions --verbose "/goal Follow goals/STOCKS-UPDATE.md. Done when /tmp/verify-stocks.py exits 0." > /tmp/stocks-update.log 2>&1
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
