# Goal: Portfolio Update

Quarterly refresh of guru holdings + DataRoma Top 20 against the live Dataroma
source. Run after each new 13F deadline (mid-May, mid-Aug, mid-Nov, mid-Feb).

This Goal updates **portfolio composition** (holdings, history, weights, new
tickers). For pure price refreshes between quarters, use `STOCKS-UPDATE.md`.

---

## When to run

A new quarter is considered "available" once **45 days after quarter-end** have
passed (13F filing deadline). On `today`:

- If `today ≥ quarter_end + 45d` for some quarter Q that isn't yet in the data
  → there's work to do, run this Goal.
- Otherwise → nothing to update; consider running `STOCKS-UPDATE.md` instead.

The "target quarter" `Q_target` for this run is the most recent quarter whose
13F window is open and isn't fully reflected in the JSON yet. Determine it
freshly from `today`, don't hard-code dates.

---

## Hard constraints

- Mutate only `public/default-data.json`.
- **Do NOT touch** `public/default-data.backup-1.json`, `backup-2.json`,
  `backup-3.json`. Those are app-managed snapshots.
- **MANDATORY first step: copy current `public/default-data.json` to
  `/tmp/default-data.pre-portfolio-update.json` BEFORE making any change.**
  The verify script reads this file to detect forbidden mutations. If you
  forget this step, verify will FAIL and you cannot pass the done condition.
- **DO NOT change visual / structural fields** on any portfolio:
  - `color` — user-curated, never touch.
  - position in the `portfolios[]` array — preserve original order exactly.
  - `id`, `name`, `kind`, `visible`, `locked` — never touch.
  - `subtitle` — only allowed to change for the 9 gurus + `dataroma-top20`
    (the quarter label). All other portfolios' subtitles stay byte-identical.
- **DO NOT add or remove portfolios.** This Goal only refreshes existing entries.
- **DO NOT change** `src/portfolio_tracker.jsx` or any other source file.
- **DO NOT touch** portfolios with `id` in: `mine`, `youtuber`, `voo`, `vt`.
  Their entire JSON object stays byte-identical to the pre-update snapshot.
- No git commits, no PRs.

---

## Data model (recap)

```
portfolio = {
  id, name, subtitle, kind, color, visible, locked,
  holdings:  [ { ticker, weight }, … ]  // CURRENT snapshot (implicit asOf = one
                                        //   quarter after the last history entry)
  history:   [ { asOf:"YYYY-MM-DD", holdings:[…] }, … ]  // previous snapshots
}

prices = {
  TICKER_UPPER: { "YYYY-MM-01": close_price, … }  // first-of-month only, no off-day keys
}
```

`asOf` is always a quarter-end: `YYYY-03-31`, `YYYY-06-30`, `YYYY-09-30`,
`YYYY-12-31`. The implicit `asOf` of `holdings` is one quarter past the last
`history.asOf`.

---

## Step 1 — Determine `Q_target` and the new `asOf` for the previous current

Given `today`:

1. Find the most recent quarter-end at least 45 days ago. That's `Q_target`'s
   asOf, e.g. on `2026-05-19` → `Q_target.asOf = 2026-03-31` (49 days ago).
2. For each non-protected portfolio with `history.length >= 1`, compute the
   implicit `asOf` of its current `holdings`:
   - `last_hist_asOf = max(history[].asOf)`
   - `current_asOf_implicit = last_hist_asOf + 3 months, snapped to quarter-end`
3. If `current_asOf_implicit == Q_target.asOf` → this portfolio is already up to
   date, skip it.
4. Otherwise → push current `holdings` into `history` with `asOf =
   current_asOf_implicit`, then fetch new Q_target data and put it into `holdings`.

This generalizes the original Q1 2026 update: works for Q2 2026, Q3 2026, etc.

---

## Step 2 — Refresh holdings from Dataroma (the 9 gurus)

For each of these portfolio ids:

```
lilu                                Li Lu (Himalaya)
buffett                             Warren Buffett (BRK)
custom-1777150247501                Greenhaven (GA)
custom-1777225955634                Robert Vinall (RV)
custom-1777150124526                Chris Hohn (C)
custom-1777150376264                Josh Tarasoff (GBP)
custom-1777227848490                AltaRock (AR)
custom-1777228154883                David Abrams (AB)
custom-1777225852884                Valley Forge Capital Management (VFC)
```

**For each portfolio:**

1. Verify the manager code by searching `https://www.dataroma.com/m/managers.php`
   for the portfolio's `name`. (Codes change rarely but verify, don't trust
   the table above blindly.)
2. Fetch `https://www.dataroma.com/m/holdings.php?m=<code>`.
3. Parse the holdings table for Q_target. Extract: **ticker symbol** (column 1
   — NOT the company name) + **% of Portfolio** column as a float.
4. **Filter**: keep only rows with `weight ≥ 1.0`. Sub-1% positions are noise.
5. **Renormalize** the kept weights so they sum to 100.0 (divide each by kept-sum,
   multiply by 100, round to 2 decimals).
6. **Dual-class share classes (`BRK.A`, `BRK.B`, `GOOG`, `GOOGL`, `BF.A`, `BF.B`,
   etc.) — keep separate**, do NOT merge. Display merging is handled by the
   app's `Merge dual-class` toggle.
7. Push old `holdings` into `history` (see Step 1), set new `holdings` to the
   parsed list.
8. Update `subtitle` to end with `"Q<N> <YYYY> (<K>q chain-linked)"` where K =
   `history.length + 1`. e.g. on the Q2 2026 update, Buffett's subtitle becomes
   `"Buffett · DataRoma · Q2 2026 (6q chain-linked)"`.

**Cross-check after parse:** the kept weights should sum to roughly 80-100%
before renormalization (typical Dataroma top names cover this much of any
portfolio). If your parsed kept-sum is, say, 30% — you're probably reading the
wrong column or the wrong page.

---

## Step 3 — Refresh DataRoma Top 20

Portfolio id: `dataroma-top20`.

1. Fetch `https://www.dataroma.com/m/g/portfolio.php` (the all-guru consensus
   page — NOT the S&P 500 grid).
2. Take the **top 20 by % of Portfolio**.
3. Apply Step 1's push-current-into-history logic with `asOf = Q_target.asOf`.
4. Set new `holdings` to those 20.
5. Update `subtitle` to `"DataRoma consensus · Top 20 · Q<N> <YYYY> (<K>q chain-linked)"`.

Dual-class consensus entries (e.g. both `BRK.A` and `BRK.B`) are valid; keep
both.

---

## Step 4 — Backfill prices for any new tickers

After Steps 2-3, recompute the referenced ticker set:

```python
referenced = set()
for p in data["portfolios"]:
    for h in p["holdings"]: referenced.add(h["ticker"].upper())
    for s in p.get("history", []):
        for h in s["holdings"]: referenced.add(h["ticker"].upper())
```

For each `T in referenced` where `T not in data["prices"]`:

1. Primary source: `https://stockanalysis.com/stocks/<lower>/history/` (or
   `/etf/<lower>/history/` for ETFs).
2. Fetch the **monthly** close series — most history pages have a "Monthly"
   toggle. Use Adjusted Close (handles splits/dividends).
3. Date range: from `2025-01-01` through the first-of-month of the
   most-recently-completed month relative to `today`. e.g. on `2026-05-19`,
   include `2026-05-01` (May 1 close is known) but not `2026-06-01`.
4. Write into `data.prices[T]` with keys strictly matching `YYYY-MM-01`.
   - Many sources return end-of-month or arbitrary trading days. Map them to
     the first-of-month of the **same calendar month** (e.g. `2025-04-30` →
     `2025-05-01`; `2026-01-02` → `2026-01-01`; `2025-04-15` → `2025-04-01`).
   - If two source rows map to the same `YYYY-MM-01`, keep the one from the
     first trading day of that month, drop the other.
5. Verify per-ticker coverage: ≥14 months between `2025-01-01` and the latest
   target. If a ticker only has 6 months, you didn't fetch wide enough.

**Ticker quirks:**

| Ticker      | Notes                                                          |
|-------------|----------------------------------------------------------------|
| `GOOG`,`GOOGL` | Both real, store separately (display merge handles them)    |
| `BRK.A`,`BRK.B` | Both real, store separately. **BRK.A ≈ $700k/share**, BRK.B ≈ $500. Don't conflate. |
| `BF.A`,`BF.B`   | Brown-Forman classes, both real, keep separate              |
| `HEI.A`,`LEN.B`,`UHAL.B` | Real share classes, keep                            |
| `REMEDY.HE`     | Helsinki-listed. Try `stockanalysis.com/quote/hel/REMEDY/` or fallback to Investing.com |
| `SGOV`          | iShares 0-3 Month Treasury ETF: `stockanalysis.com/etf/sgov/` |
| ADRs (`SONY`,`ASML`,`DEO`,`TSM`,`PDD`) | Use the US-listed ADR price, not home market |
| Recent IPO (`CRCL`) | May have started trading mid-year — that's fine, leave earlier months absent |

**Stock splits / large corporate actions:** stockanalysis.com Adjusted Close
handles this automatically. If you see a >50% one-month gap, check whether
there was a real split — if yes, all earlier prices should already be split-
adjusted on stockanalysis (re-fetch if your earlier data wasn't adjusted).

---

## Step 5 — Bring all existing tickers up to the current month

For every `T in data["prices"]`:

1. Determine the target last date: first-of-month of the most-recently-completed
   calendar month relative to `today`. On `today = 2026-05-19` that's
   `2026-05-01`.
2. If `data["prices"][T]`'s max key already `>= target` → skip this ticker.
3. Otherwise fetch monthly history from stockanalysis.com (same approach as
   Step 4) and append the missing `YYYY-MM-01` keys.

This guarantees that after the Goal runs, **every referenced ticker** has
prices up to and including the latest fully-known month.

---

## Verification (run after every iteration)

Write to `/tmp/verify_portfolio.py`, execute, must exit 0.

```python
#!/usr/bin/env python3
"""Verify a Portfolio Update run."""
import json, sys, re, os
from datetime import datetime, timedelta

DATA = "public/default-data.json"
SNAPSHOT = "/tmp/default-data.pre-portfolio-update.json"
PROTECTED_IDS = {"mine", "youtuber", "voo", "vt"}
# Subtitle is the only portfolio-level field the Goal is allowed to change,
# and only on these portfolios.
SUBTITLE_MUTABLE_IDS = {
    "lilu", "buffett", "dataroma-top20",
    "custom-1777150247501", "custom-1777225955634", "custom-1777150124526",
    "custom-1777150376264", "custom-1777227848490", "custom-1777228154883",
    "custom-1777225852884",
}

def today_anchor():
    """Return the YYYY-MM-01 key that prices must reach."""
    t = datetime.fromisoformat("__TODAY__")  # Goal substitutes today's date here
    first_of_this_month = t.replace(day=1)
    prev = first_of_this_month - timedelta(days=1)
    return f"{prev.year}-{prev.month:02d}-01"
TARGET_DATE = today_anchor()

errors = []
def E(msg): errors.append(msg)

with open(DATA) as f: data = json.load(f)
by_id = {p["id"]: p for p in data["portfolios"]}

# ----- MANDATORY: pre-update snapshot must exist -----
if not os.path.exists(SNAPSHOT):
    print(f"FAIL: snapshot {SNAPSHOT} does not exist. Goal must copy public/default-data.json "
          f"to this path BEFORE making any change. Re-run from a clean state.")
    sys.exit(1)
with open(SNAPSHOT) as f: snap = json.load(f)
snap_by_id = {p["id"]: p for p in snap["portfolios"]}

# ----- Portfolio set unchanged: same ids, same order -----
cur_ids = [p["id"] for p in data["portfolios"]]
snap_ids = [p["id"] for p in snap["portfolios"]]
if cur_ids != snap_ids:
    added = set(cur_ids) - set(snap_ids)
    removed = set(snap_ids) - set(cur_ids)
    if added: E(f"order/set: portfolios added: {sorted(added)}")
    if removed: E(f"order/set: portfolios removed: {sorted(removed)}")
    if not added and not removed:
        # Same set, different order → list the diff positions
        diff = [(i, snap_ids[i], cur_ids[i]) for i in range(len(cur_ids)) if snap_ids[i] != cur_ids[i]]
        E(f"order: portfolios reordered at positions {diff[:5]}")

# ----- Visual/structural fields unchanged for EVERY portfolio -----
# Goal may only touch holdings, history, and subtitle (on whitelisted ids).
FROZEN_FIELDS = ["id", "name", "kind", "color", "visible", "locked"]
for p in data["portfolios"]:
    pid = p["id"]
    if pid not in snap_by_id: continue  # caught by order/set check above
    sp = snap_by_id[pid]
    for fld in FROZEN_FIELDS:
        if p.get(fld) != sp.get(fld):
            E(f"frozen-field: {pid}.{fld} changed: {sp.get(fld)!r} → {p.get(fld)!r}")
    if pid not in SUBTITLE_MUTABLE_IDS and p.get("subtitle") != sp.get("subtitle"):
        E(f"frozen-field: {pid}.subtitle changed (not in mutable whitelist): "
          f"{sp.get('subtitle')!r} → {p.get('subtitle')!r}")

# ----- Protected portfolios: holdings/history must be byte-identical too -----
for pid in PROTECTED_IDS:
    if pid in by_id and pid in snap_by_id:
        if json.dumps(by_id[pid], sort_keys=True) != json.dumps(snap_by_id[pid], sort_keys=True):
            E(f"protected: {pid} was modified (must be byte-identical to snapshot)")

# ----- Holdings structure -----
for p in data["portfolios"]:
    if p["id"] in PROTECTED_IDS: continue
    if p["kind"] not in {"guru", "custom"}: continue
    h_asofs = [s["asOf"] for s in p.get("history", [])]
    # No duplicate asOfs
    if len(set(h_asofs)) != len(h_asofs):
        E(f"{p['id']}: duplicate asOf in history: {h_asofs}")
    # asOf must be quarter-end
    for a in h_asofs:
        if a not in {f"{y}-{q}" for y in range(2024, 2030)
                     for q in ["03-31","06-30","09-30","12-31"]}:
            E(f"{p['id']}: non-quarter asOf {a}")
    # Weights sane
    ws = sum(h["weight"] for h in p["holdings"])
    if not 95 <= ws <= 101: E(f"{p['id']}: current weights sum {ws:.2f}")
    for s in p.get("history", []):
        ws2 = sum(h["weight"] for h in s["holdings"])
        if not 95 <= ws2 <= 101: E(f"{p['id']} {s['asOf']}: weights sum {ws2:.2f}")
    # Min 1% threshold respected — no kept position should be < 1.0
    # (allowing 0.95 for rounding noise after renormalization of borderline rows)
    for h in p["holdings"]:
        if h["weight"] < 0.95: E(f"{p['id']}: holding {h['ticker']} weight {h['weight']} < 1.0 threshold")

# ----- Prices: monthly-only, no off-day keys -----
for t, px in data["prices"].items():
    for k in px:
        if not re.match(r"^\d{4}-\d{2}-01$", k):
            E(f"price-key: {t} has non-monthly key {k!r}")
            break  # one report per ticker is enough
    if not px:
        E(f"price: {t} has empty price dict"); continue
    # No bad values
    for k, v in px.items():
        if v is None or v <= 0 or v != v:  # NaN check
            E(f"price-bad: {t}/{k} = {v}")

# ----- Prices: every referenced ticker present AND covers target date -----
referenced = set()
for p in data["portfolios"]:
    for h in p["holdings"]: referenced.add(h["ticker"].upper())
    for s in p.get("history", []):
        for h in s["holdings"]: referenced.add(h["ticker"].upper())

for t in sorted(referenced):
    if t not in data["prices"]:
        E(f"price: no data for referenced ticker {t}"); continue
    px = data["prices"][t]
    last = max(px.keys())
    if last < TARGET_DATE:
        E(f"price-stale: {t} latest is {last}, target {TARGET_DATE}")

# ----- Prices: no absurd month-over-month jumps -----
for t, px in data["prices"].items():
    dates = sorted(px.keys())
    for i in range(1, len(dates)):
        prev, curr = px[dates[i-1]], px[dates[i]]
        if prev <= 0: continue
        r = curr / prev
        if r > 1.5 or r < 0.67:
            E(f"price-jump: {t} {dates[i-1]}={prev} → {dates[i]}={curr} ({r:.2f}×)")

# ----- BRK.A sanity (special case — historically conflated with BRK.B) -----
if "BRK.A" in data["prices"]:
    for k, v in data["prices"]["BRK.A"].items():
        if v < 100000:  # Class A is always > $400k
            E(f"price-sanity: BRK.A {k}={v} looks like Class B price")

# (Protected-portfolio check is above — uses snapshot diff, not a procedural rule.)

# ----- Reports -----
if errors:
    print(f"FAIL: {len(errors)} errors")
    for e in errors[:50]: print(" -", e)
    if len(errors) > 50: print(f"  ... +{len(errors)-50} more")
    sys.exit(1)
print(f"OK: {len(referenced)} tickers referenced, target date {TARGET_DATE}")
```

(The `__TODAY__` placeholder: Goal substitutes today's ISO date when writing
the script, e.g. `2026-05-19`. The verify then resolves the target date itself.)

---

## Chart smoke test

Write to `/tmp/chart-smoke.mjs`. Imitates `computeSeries` from
[`src/portfolio_tracker.jsx`](src/portfolio_tracker.jsx) and fails if any
non-benchmark portfolio renders fewer than 12 data points, starts at a value
significantly different from 100, or shows a >25% month-over-month spike.

```javascript
import fs from 'fs';
const data = JSON.parse(fs.readFileSync('public/default-data.json', 'utf8'));
const prices = {};
for (const [t, v] of Object.entries(data.prices)) prices[t.toUpperCase()] = v;

const closestLE = (dates, target) => {
  let lo=0,hi=dates.length-1,ans=null;
  while (lo<=hi){const m=(lo+hi)>>1;if(dates[m]<=target){ans=dates[m];lo=m+1}else hi=m-1}
  return ans;
};

const computeSeries = (p) => {
  if (!p.holdings?.length) return [];
  const hist = [...(p.history||[])].sort((a,b)=>a.asOf.localeCompare(b.asOf));
  if (!hist.length) {
    const valid = p.holdings.filter(h => prices[h.ticker.toUpperCase()]);
    if (!valid.length) return [];
    const ds = valid.map(h => new Set(Object.keys(prices[h.ticker.toUpperCase()])));
    const common = [...ds[0]].filter(d => ds.every(s=>s.has(d))).sort();
    if (common.length<2) return [];
    const tw = valid.reduce((s,h)=>s+h.weight,0);
    return common.map(d => {
      let v=0;
      for (const h of valid) {
        const T=h.ticker.toUpperCase();
        v += (h.weight/tw)*(prices[T][d]/prices[T][common[0]]);
      }
      return {date:d, value:v*100};
    });
  }
  const lastA = hist[hist.length-1].asOf;
  const [y,m]=lastA.split('-').map(Number);
  const nm=m+3, ny=y+Math.floor((nm-1)/12), nmm=((nm-1)%12)+1;
  const ld=new Date(ny,nmm,0).getDate();
  const ca=`${ny}-${String(nmm).padStart(2,'0')}-${String(ld).padStart(2,'0')}`;
  const snaps=[...hist, {asOf:ca, holdings:p.holdings}];
  const dateSet=new Set();
  snaps.forEach(s=>s.holdings.forEach(h=>{
    const px=prices[h.ticker.toUpperCase()]; if(px) Object.keys(px).forEach(d=>dateSet.add(d));
  }));
  const allDates=[...dateSet].sort();
  if (allDates.length<2) return [];
  const segs=[];
  for (let i=0;i<snaps.length;i++) {
    const f = i===0 ? allDates[0] : closestLE(allDates, snaps[i].asOf);
    if (!f) continue;
    let to;
    if (i+1<snaps.length) {to=closestLE(allDates,snaps[i+1].asOf); if(!to||to<=f) continue;}
    else to=allDates[allDates.length-1];
    segs.push({holdings:snaps[i].holdings, fromDate:f, toDate:to, isLast:i===snaps.length-1});
  }
  const result=[]; let cum=1.0;
  for (const seg of segs) {
    const valid = seg.holdings.filter(h => prices[h.ticker.toUpperCase()]?.[seg.fromDate]!==undefined);
    if (!valid.length) continue;
    const tw=valid.reduce((s,h)=>s+h.weight,0); if (tw===0) continue;
    const spx={}; valid.forEach(h=>{spx[h.ticker.toUpperCase()]=prices[h.ticker.toUpperCase()][seg.fromDate]});
    const segDates=allDates.filter(d=>d>=seg.fromDate && (seg.isLast?d<=seg.toDate:d<seg.toDate));
    for (const d of segDates) {
      let f=0;
      for (const h of valid) {
        const T=h.ticker.toUpperCase(); const cp=prices[T][d];
        if (cp===undefined) continue;
        f += (h.weight/tw)*(cp/spx[T]);
      }
      result.push({date:d, value:cum*f*100});
    }
    if (!seg.isLast) {
      let bf=0;
      for (const h of valid) {
        const T=h.ticker.toUpperCase(); const ep=prices[T][seg.toDate];
        if (ep===undefined) continue;
        bf += (h.weight/tw)*(ep/spx[T]);
      }
      cum*=bf;
    }
  }
  return result;
};

let critical = [];
for (const p of data.portfolios) {
  if (p.kind === 'benchmark' && p.holdings.length===1 && p.holdings[0].ticker===p.id.toUpperCase()) continue;
  const s = computeSeries(p);
  if (s.length < 12) critical.push(`${p.name}: only ${s.length} chart points`);
  if (s.length && Math.abs(s[0].value - 100) > 1) critical.push(`${p.name}: starts at ${s[0].value.toFixed(2)} (must be 100±1)`);
  for (const pt of s) if (pt.value < 30 || pt.value > 300) { critical.push(`${p.name}: ${pt.value.toFixed(2)} at ${pt.date}`); break; }
  for (let i=1; i<s.length; i++) {
    const r = s[i].value / s[i-1].value;
    if (r > 1.25 || r < 0.80)
      critical.push(`${p.name}: ${(r*100-100).toFixed(1)}% spike ${s[i-1].date}→${s[i].date}`);
  }
}
if (critical.length) {
  console.log(`FAIL: ${critical.length} chart issues`);
  for (const c of critical.slice(0,30)) console.log("  ", c);
  process.exit(1);
}
console.log("chart-smoke OK");
```

---

## Iteration loop

```
0. MANDATORY (only on iter 1 — before any mutation):
   cp public/default-data.json /tmp/default-data.pre-portfolio-update.json
   This file is the reference for verify's frozen-field checks. If it
   doesn't exist when verify runs, verify fails immediately.

for iter in 1..10:
    1. Read public/default-data.json
    2. Determine Q_target from today's date (see Step 1)
    3. Execute Steps 2-5 for any portfolio/ticker not yet up to Q_target
    4. Run verify_portfolio.py
    5. Run node chart-smoke.mjs
    6. If both pass: DONE
    7. Otherwise: read the failure, fix specifically what's listed, loop.
       Never widen the verify tolerances to make it pass.
       In particular, NEVER touch color / order / id / name / kind / visible /
       locked — those are frozen by snapshot diff and any change is a FAIL
       you cannot resolve by editing the data further.
```

Append a one-line log of each iteration to `/tmp/portfolio-update-log.txt`.

---

## Done condition

All three pass:

1. `python3 /tmp/verify_portfolio.py` exits 0 with `OK: <N> tickers referenced…`
2. `node /tmp/chart-smoke.mjs` exits 0 with `chart-smoke OK`
3. `npm run dev` in background + `curl -s http://localhost:5173` returns 200
   with `<div id="root">`. Dev server stderr has no error in first 3s.

Then print the contents of `/tmp/portfolio-update-log.txt` and exit.

---

## What NOT to do

- Do not touch `default-data.backup-*.json`. They are user-curated snapshots.
- Do not touch the `color` field on any portfolio.
- Do not change the order of portfolios in the `portfolios[]` array.
- Do not touch `id`, `name`, `kind`, `visible`, or `locked` on any portfolio.
- Do not add or remove portfolios — this Goal refreshes existing ones only.
- Do not edit `src/portfolio_tracker.jsx` or any other source file.
- Do not invent holdings from memory — every ticker must come from the live
  Dataroma page for `Q_target`.
- Do not store daily prices. Only `YYYY-MM-01` keys, one per month.
- Do not relax verify tolerances to make the Goal pass.
- Do not commit / open PRs.
- Do not "merge" share classes (BRK.A+BRK.B → BRK) in the data. That's a
  display concern, handled by the app's global toggle.
