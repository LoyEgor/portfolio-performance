#!/bin/bash
# overnight-finalize.sh — unattended overnight wrap-up of the investor base.
#
# Pre-req: BACKFILL --years=10 --force has finished, post-process script ran,
#          verify passed, commit #1 made. Base is clean.
#
# What this does (autonomously, no interaction):
#   1. INVESTORS-ADD × 5 for the missing DataRoma managers, each at --years=10.
#   2. INVESTORS-BACKFILL --investors=dataroma-top20 --years=10 --force —
#      try to deepen the aggregate snapshot via Web Archive captures of
#      dataroma.com/m/g/portfolio.php. Best-effort: pre-2021 captures may
#      be sparse, so completion is not guaranteed. Goal logs gaps and moves on.
#   3. git commit (if anything was added/extended).
#   4. STOCKS-UPDATE for all tickers (fills prices for new investors + deep history).
#   5. git commit (if any price files changed).
#
# Run from project root, launched via nohup so terminal can be closed:
#   nohup bash scripts/overnight-finalize.sh > /dev/null 2>&1 &
#
# Morning check:
#   tail -80 /tmp/overnight-finalize.log
#   git log --oneline -5

set +e  # Don't abort on individual goal failures — log and continue.

LOG=/tmp/overnight-finalize.log
PROJECT_DIR="/Volumes/Work/Projects/portfolio-performance"
cd "$PROJECT_DIR" || { echo "FATAL: cd $PROJECT_DIR failed"; exit 1; }

# All output to the log.
exec >> "$LOG" 2>&1
echo ""
echo "=========================================="
echo "=== overnight-finalize START: $(date)  ==="
echo "=========================================="

# Confirm starting state is clean — otherwise we'd commit stuff we shouldn't.
if [ -n "$(git status -s)" ]; then
  echo "FATAL: working tree not clean. Aborting to avoid committing stale changes."
  git status -s
  exit 1
fi

run_goal() {
  local desc="$1"; shift
  echo ""
  echo "--- [$desc] START: $(date) ---"
  claude -p --dangerously-skip-permissions --verbose "$@"
  local rc=$?
  echo "--- [$desc] END (rc=$rc): $(date) ---"
}

# === Phase 1: Add 5 missing DataRoma investors ===
# (name | DataRoma manager code) — codes verified against dataroma.com/m/home.php.
for entry in \
    "Leon Cooperman|oa" \
    "Tom Bancroft|MP" \
    "Thomas Russo|GR" \
    "Thomas Gayner|MKL" \
    "Torray Funds|T"
do
  name="${entry%|*}"
  code="${entry#*|}"
  run_goal "ADD $name" \
    "/goal Follow goals/INVESTORS-ADD.md with --name='$name' --source-hint=dataroma/$code --years=10. Run UNATTENDED — do NOT use the AskUserQuestion tool. If a decision is ambiguous, pick the conservative option (skip > error > guess), log the choice to /tmp/overnight-decisions.log, and continue. Never stop to ask the user."
done

# === Phase 2: Deepen dataroma-top20 aggregate via Web Archive ===
# Currently sits at ~16 quarters (Q1 2021 → Q1 2026); 10y target is ~41 quarters.
# Goal will try Web Archive captures of dataroma.com/m/g/portfolio.php for the
# missing 2016-2020 quarters. Best effort — pre-2021 captures may not exist.
run_goal "BACKFILL dataroma-top20 to 10y" \
  "/goal Follow goals/INVESTORS-BACKFILL.md with --investors=dataroma-top20 --years=10 --force. Run UNATTENDED — do NOT use AskUserQuestion. If a historical quarter has no archive capture in any source, log to /tmp/overnight-decisions.log and skip that quarter (don't fail the run). Never stop to ask the user."

# === Phase 3: Commit added/extended investors ===
echo ""
if [ -n "$(git status -s public/data/)" ]; then
  git add public/data/
  git commit -m "feat: complete DataRoma base — 5 missing managers + dataroma-top20 deepening

Leon Cooperman, Tom Bancroft, Thomas Russo, Thomas Gayner, Torray Funds —
added via INVESTORS-ADD --years=10. Brings individual investors to 80.

dataroma-top20 aggregate deepened toward 10y via Web Archive captures of
m/g/portfolio.php (best effort — some pre-2021 quarters may have no archive)."
  echo "[$(date)] commit: ADD × 5 + dataroma-top20 landed"
else
  echo "[$(date)] no changes after ADD + aggregate-deepen phase — skipping commit"
fi

# === Phase 4: Stocks update for everything ===
run_goal "STOCKS-UPDATE" \
  "/goal Follow goals/STOCKS-UPDATE.md. Run UNATTENDED — do NOT use the AskUserQuestion tool. If a ticker cannot be fetched after the full fallback chain, log it to /tmp/overnight-decisions.log and continue with the next ticker. Never stop to ask the user."

# === Phase 5: Commit price coverage ===
echo ""
if [ -n "$(git status -s public/data/)" ]; then
  git add public/data/prices/ public/data/meta.json
  git commit -m "data: stocks-update for new investors + 10y history

Fills prices for tickers introduced by the 5 newly-added investors and any
pre-2021 quarters that came in via the 10y backfill. Goal handles fallback
chain (stockanalysis.com → Yahoo → Google → MarketWatch → Investing.com)."
  echo "[$(date)] commit: stocks update landed"
else
  echo "[$(date)] no changes after STOCKS-UPDATE phase — skipping commit"
fi

echo ""
echo "=========================================="
echo "=== overnight-finalize DONE: $(date)   ==="
echo "=========================================="
echo "Review:"
echo "  git log --oneline -5"
echo "  cat /tmp/overnight-decisions.log  # any ambiguous choices the goals made"
