# Goal: Add Investor

Add a single investor to the base, by name (with optional source hint).

Picks the most popular match across sources (by AUM), fetches history up to
`meta.latestQuarter` — never beyond, to keep the base aligned.

> **How this file is used.** This is a goal specification consumed by Claude
> Code's `/goal` command (introduced in Claude Code 2.1.139). The harness keeps
> looping turns until the **Done condition** at the bottom is satisfied. Don't
> run this file with plain `claude -p` (single turn) — it won't iterate. See
> `goals/README.md` for the full `/goal` invocation form.

---

## Parameters

| Param | Required | Effect |
|---|---|---|
| `--name="<Full Name>"` | yes | Search query, e.g. `"Bill Ackman"`, `"Stanley Druckenmiller"`. |
| `--source-hint=<source>/<code>` | no | Force a specific source + code, e.g. `--source-hint=stockzoa/pershing-square-capital`. Useful when the most-popular auto-pick isn't who you want. |
| `--force` | no | If an investor with the same derived id already exists, overwrite instead of erroring. |

---

## Hard constraints

- Mutate ONLY:
  - `public/data/investors-index.json` (add one entry)
  - `public/data/investors/<id>.json` (create one new file)
- Do NOT touch `prices.json` — run `STOCKS-UPDATE.md` separately after to fill
  ticker prices.
- Do NOT touch `public/default-data.json`, `public/default-data.backup-*.json`,
  source files.
- Save snapshot of `investors-index.json` before mutation:
  `cp public/data/investors-index.json /tmp/investors-index.pre-add.json`
- Never fetch history beyond `meta.latestQuarter` — the base must stay
  synchronized to one quarter for all investors.
- No git commits, no PRs.

---

## What the goal does

### Phase A — Discover

1. Read `public/data/meta.json` for `latestQuarter` (history cap).
2. Read `public/data/investors-index.json` to know what IDs already exist.
3. If `--source-hint` is provided: go directly to that source/code.
4. Otherwise, search sources in priority order from `README.md`. For each
   source, try the search endpoint with `--name`.
5. Collect candidates from each source: `{ source, code, name, AUM, link }`.
6. Pick the candidate with the highest AUM as the primary. If multiple
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

1. Fetch holdings from the chosen source for every quarter from earliest
   available (per source's history depth) up to `meta.latestQuarter`. Do NOT
   exceed `latestQuarter` even if the source has fresher data.
2. Parse holdings using the same rules as `INVESTORS-BACKFILL.md`:
   - Filter to `weight ≥ 1.0%`.
   - Renormalize kept weights to sum to 100.
   - Dual-class stays separate.

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

# Don't exceed meta.latestQuarter
lq = meta.get("latestQuarter")
asofs = [s.get("asOf") for s in (inv.get("history") or [])]
if asofs and max(asofs) > lq:
    E(f"history exceeds meta.latestQuarter: max={max(asofs)} > {lq}")

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
