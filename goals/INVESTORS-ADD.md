# Goal: Add Investor

Add a single investor to the base, by name (with optional source hint).

Picks the most popular match across sources (by AUM), fetches history up to
`meta.latestQuarter` — never beyond, to keep the base aligned.

> **How this file is used.** This is a goal specification consumed by Claude
> Code's `/goal` command (introduced in Claude Code 2.1.139). The harness keeps
> looping turns until the **Done condition** at the bottom is satisfied — it
> reads the spec each turn and uses that section as the completion check, so
> you don't need to paste it into the command. Run it interactively: open
> `claude --dangerously-skip-permissions`, then type
> `/goal Follow goals/INVESTORS-ADD.md with --name='…'` inside the session.
> Avoid headless `claude -p` for hand-launched runs; it hides progress until
> the very end. See `goals/README.md` for the command catalog.

---

## Parameters

| Param | Required | Effect |
|---|---|---|
| `--name="<Full Name>"` | yes | Search query, e.g. `"Bill Ackman"`, `"Stanley Druckenmiller"`. |
| `--source-hint=<source>/<code>` | no | Force a specific source + code, e.g. `--source-hint=stockzoa/pershing-square-capital`. Useful when the most-popular auto-pick isn't who you want. |
| `--years=N` | no | Fetch history `N` years back from `meta.latestQuarter`. If omitted, **defaults to matching the base's existing depth** (`meta.oldestHistoryAsOf`). If meta has no `oldestHistoryAsOf` (fresh base), fall back to whatever the primary source naturally has (~5y on DataRoma). |
| `--force` | no | If an investor with the same derived id already exists, overwrite instead of erroring. |

---

## Hard constraints

- Mutate ONLY:
  - `public/data/investors-index.json` (add one entry)
  - `public/data/investors/<id>.json` (create one new file)
  - `public/data/meta.json` — only if the new investor's history extends the
    base's depth (i.e., `min(asOf) < meta.oldestHistoryAsOf`). In that case
    update `meta.oldestHistoryAsOf` to the new minimum. Otherwise leave meta
    untouched.
- Do NOT touch `public/data/prices/*.json` — run `STOCKS-UPDATE.md` separately
  after to fill ticker prices.
- Do NOT touch `public/default-data.json`, `public/default-data.backup-*.json`,
  source files.
- Save snapshot of `investors-index.json` before mutation:
  `cp public/data/investors-index.json /tmp/investors-index.pre-add.json`
- Never fetch history beyond `meta.latestQuarter` — the base must stay
  synchronized to one quarter for all investors.
- **Ticker hygiene** (see `goals/README.md → Ticker hygiene` — non-negotiable):
  - Normalize `BRK-B` → `BRK.B` (DOT separator for dual-class) before writing.
  - Drop tickers matching `-OLD$` / `Q-OLD$` (parser-internal markers).
  - Prefer the US ticker form when a company is dual-listed on a foreign
    exchange (`.TO`, `.L`, `.MX`, `.SW`, `.DE`, `.MI`) and a US ticker also
    appears in the source.
- No git commits, no PRs.

---

## What the goal does

### Phase A — Discover

1. Read `public/data/meta.json` for:
   - `latestQuarter` (history cap — never fetch beyond this).
   - `oldestHistoryAsOf` (base's existing depth target).
2. Determine the **target depth** for this run:
   - If `--years=N` is given → target = `latestQuarter - N years` (quarter-aligned).
   - Else if `meta.oldestHistoryAsOf` is set → target = `meta.oldestHistoryAsOf`
     (match the rest of the base).
   - Else → target = whatever the primary source naturally provides
     (~5y on DataRoma).
   Log the resolved target to `/tmp/investors-add-log.txt` so the run is
   self-documenting.
3. Read `public/data/investors-index.json` to know what IDs already exist.
4. If `--source-hint` is provided: go directly to that source/code.
5. Otherwise, search sources in priority order from `README.md`. For each
   source, try the search endpoint with `--name`.
6. Collect candidates from each source: `{ source, code, name, AUM, link }`.
7. Pick the candidate with the highest AUM as the primary. If multiple
   candidates share a similar name and AUM is missing or close, halt with a
   warning listing the alternatives (user re-runs with `--source-hint`).

### Phase B — Determine ID

Generate a stable `id` from the name:
- Lowercase
- Replace spaces and special chars with `-`
- Strip leading/trailing dashes
- Truncate to 32 chars
- Example: `"Bill Ackman"` → `"bill-ackman"`, `"David Tepper"` → `"david-tepper"`.

If the id collides with an existing investor:
- If `--force` is set, overwrite the existing file (and warn loudly).
- Otherwise, abort with an error showing the collision.

### Phase C — Fetch

1. Fetch holdings from the primary source for every quarter the source has,
   from earliest available up to `meta.latestQuarter`. Never exceed
   `latestQuarter`.
2. **If primary source doesn't reach the target depth** (typical: DataRoma
   stops at ~5y, but target is deeper), fall back through the priority chain
   in `README.md` for the missing earlier quarters:
   - 13F.info per-quarter pages
   - Web Archive captures of DataRoma `holdings.php?m=<code>` from `+15..+60`
     days after each historical 13F deadline (15 May / 14 Aug / 14 Nov / 14 Feb)
   - stockzoa, valuesider, GuruFocus, WhaleWisdom, HedgeFollow, StockCircle
3. If even the fallback chain can't reach the target → fetch what's available,
   log gaps to `/tmp/investors-add-log.txt` as `(investor, quarter, "no source had data")`,
   continue with what you got. Do NOT halt the run on partial depth.
4. Parse holdings using the same rules as `INVESTORS-BACKFILL.md`:
   - Filter to `weight ≥ 1.0%`.
   - Renormalize kept weights to sum to 100.
   - Dual-class stays separate.
   - Apply ticker hygiene normalization (DOT separator, drop `-OLD`, prefer
     US ticker over foreign-exchange variant — see Hard constraints above
     and `goals/README.md → Ticker hygiene`).

### Phase D — Write

1. Create `public/data/investors/<id>.json`:
   ```json
   {
     "id": "<id>",
     "holdings": [ ... newest quarter ... ],
     "history": [ ... sorted by asOf ascending ... ],
     "_provenance": {
       "primarySource": "<source>",
       "lastFetchedAt": "<iso>",
       "lastFetchedFrom": "<url>"
     }
   }
   ```
2. Append entry to `investors-index.json`:
   ```json
   {
     "id": "<id>",
     "dataromaCode": "<code-if-source-is-dataroma>",
     "sourceCodes": { "<source>": "<code>", ... },
     "primarySource": "<source>",
     "name": "<Full Name>",
     "fund": "<Fund name if available>",
     "aum": <number-or-null>,
     "country": "<two-letter or null>",
     "link": "<URL to source profile>",
     "tags": [],
     "historyRange": { "from": "<earliest asOf>", "to": "<meta.latestQuarter>" },
     "currentHoldingsCount": <int>
   }
   ```
3. **Update `meta.oldestHistoryAsOf` if needed.** Compute the new investor's
   `min(asOf)` across their history. If it is strictly less than the current
   `meta.oldestHistoryAsOf` (or if meta has no such field yet) → write the
   new value to `meta.oldestHistoryAsOf`. Otherwise leave meta untouched.
   This keeps the field as a true `min` across the whole base.

### Phase E — Cross-validate (optional, when more than one source returned data)

For one secondary source (the next in priority that returned data), compare the
parsed holdings against the primary. If any single position's weight differs by
> 5pp between primary and secondary → log a warning but keep primary's values.
This is informational only; the user can decide whether to investigate.

---

## Verification script

Write to `/tmp/verify-add.py`. Substitute `__NEW_ID__` with the chosen id at run
time.

```python
#!/usr/bin/env python3
"""Verify a successful add-investor run."""
import json, sys, re, os

INDEX = "public/data/investors-index.json"
META = "public/data/meta.json"
NEW_ID = "__NEW_ID__"
FILE = f"public/data/investors/{NEW_ID}.json"

errors = []
def E(m): errors.append(m)

if not os.path.exists(FILE):
    print(f"FAIL: {FILE} does not exist"); sys.exit(1)

with open(INDEX) as f: index = json.load(f)
with open(META) as f: meta = json.load(f)
with open(FILE) as f: inv = json.load(f)

# Index has the new entry
idx_entry = next((i for i in index.get("investors", []) if i.get("id") == NEW_ID), None)
if not idx_entry:
    E(f"investors-index.json has no entry for {NEW_ID}")
else:
    if not idx_entry.get("primarySource"):
        E(f"{NEW_ID}: missing primarySource in index")
    if not idx_entry.get("link"):
        E(f"{NEW_ID}: missing link in index")

# File structure
if inv.get("id") != NEW_ID: E(f"file id mismatch: {inv.get('id')!r} vs {NEW_ID!r}")
h = inv.get("holdings") or []
if not h: E("holdings empty")
ws = sum((x.get("weight") or 0) for x in h)
if not (95 <= ws <= 101): E(f"current weights sum {ws:.2f}")
for s in (inv.get("history") or []):
    sw = sum((x.get("weight") or 0) for x in s.get("holdings", []))
    if not (95 <= sw <= 101): E(f"history {s['asOf']}: weights sum {sw:.2f}")
    if not re.match(r"^\d{4}-(03-31|06-30|09-30|12-31)$", s.get("asOf") or ""):
        E(f"history asOf not quarter-end: {s.get('asOf')!r}")

# Ticker hygiene (goals/README.md)
DASH_DUAL = re.compile(r"^[A-Z]+-[A-Z]$")
OLD_MARKER = re.compile(r"-OLD$")
def check_tickers(tag, holdings):
    for x in holdings:
        t = x.get("ticker") or ""
        if DASH_DUAL.match(t):
            E(f"{tag}: dash-separator dual-class {t!r} — must use DOT (BRK.B not BRK-B)")
        if OLD_MARKER.search(t):
            E(f"{tag}: leaked -OLD parser marker {t!r}")
check_tickers("current", h)
for s in (inv.get("history") or []):
    check_tickers(f"history {s['asOf']}", s.get("holdings", []))

# Don't exceed meta.latestQuarter
lq = meta.get("latestQuarter")
asofs = [s.get("asOf") for s in (inv.get("history") or [])]
if asofs and max(asofs) > lq:
    E(f"history exceeds meta.latestQuarter: max={max(asofs)} > {lq}")

# meta.oldestHistoryAsOf stays in sync (must be <= every investor's min asOf)
ohao = meta.get("oldestHistoryAsOf")
if asofs and ohao and min(asofs) < ohao:
    E(f"investor's min asOf ({min(asofs)}) < meta.oldestHistoryAsOf ({ohao}) — Phase D step 3 didn't bump meta")

# Provenance
if not (inv.get("_provenance") or {}).get("primarySource"):
    E("missing _provenance.primarySource")

if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors: print(" -", e)
    sys.exit(1)
print(f"OK: added {NEW_ID}, source={inv['_provenance']['primarySource']}, history={len(asofs)} quarters")
```

---

## Done condition

1. `python3 /tmp/verify-add.py` exits 0.
2. `git status -s public/data/` shows exactly two changes:
   - `M public/data/investors-index.json`
   - `?? public/data/investors/<id>.json` (untracked, new file)
3. `/tmp/investors-add-log.txt` contains:
   - The chosen primary source + URL
   - Candidate list (if multiple sources matched) for the user to review
   - Any cross-validation warnings
   - Reminder: "Run `STOCKS-UPDATE.md` to fill prices for new tickers."
