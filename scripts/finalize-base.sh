#!/bin/bash
# finalize-base.sh — close the remaining gaps. Foreground, visible progress.
#
# What this does (sequentially, with live output on your terminal):
#   1. INVESTORS-BACKFILL --investors=dataroma-top20 --years=10 --force
#      → closes the 11 missing aggregate quarters via the new CDX-based
#        Wayback capture-selection algorithm in the strengthened spec.
#   2. STOCKS-UPDATE
#      → fills price gaps via the new Phase 3.5 Wayback Machine fallback
#        for delisted tickers (AET, AGN, AGU, ADS, ABC, TWTR, AABA, etc.).
#
# No commits — you review `git status` after and commit when ready.
#
# Run from project root, in foreground:
#   bash scripts/finalize-base.sh
#
# Live output appears on your terminal AND is duplicated to /tmp/finalize-base.log.
# Ambiguous decisions any goal makes go to /tmp/finalize-decisions.log.
#
# To stop mid-run: Ctrl+C (the underlying /goal is idempotent — resuming
# continues where it stopped).

set +e

LOG=/tmp/finalize-base.log
# All stdout/stderr from this script + child processes → terminal AND log file.
exec > >(tee "$LOG") 2>&1

PROJECT_DIR="/Volumes/Work/Projects/portfolio-performance"
cd "$PROJECT_DIR" || { echo "FATAL: cd $PROJECT_DIR failed"; exit 1; }

echo ""
echo "================================================================"
echo "=== finalize-base START: $(date)"
echo "================================================================"

if [ -n "$(git status -s)" ]; then
  echo ""
  echo "[INFO] Working tree has uncommitted changes — that's expected"
  echo "       (spec updates + 2013-2015 cleanup from the prior session)."
  echo "       Goals will add their own data changes on top. Commit everything"
  echo "       together when the script finishes."
  echo ""
  git status -s | head -20
fi

run_goal() {
  local desc="$1"; shift
  echo ""
  echo "----------------------------------------------------------------"
  echo "----- [$desc] START: $(date)"
  echo "----------------------------------------------------------------"
  # NOTE: -p (print) mode + --verbose streams per-turn output to stdout.
  # That stdout is captured by the `exec > >(tee ...)` at the top of this
  # script, so you see it AND it lands in the log simultaneously.
  claude -p --dangerously-skip-permissions --verbose "$@"
  local rc=$?
  echo ""
  echo "----- [$desc] END (rc=$rc): $(date)"
  echo "----------------------------------------------------------------"
}

# ====================================================================
# Phase 1: Backfill dataroma-top20 with the new CDX algorithm
# ====================================================================
run_goal "BACKFILL dataroma-top20 → 10y via CDX" \
  "/goal Follow goals/INVESTORS-BACKFILL.md with --investors=dataroma-top20 --years=10 --force. Use the CDX-based capture-selection algorithm from the spec's aggregate-handling section (the new algorithm — enumerate via Wayback CDX API, assign each quarter the earliest capture in [filing_deadline(Q), filing_deadline(Q+1)]). Run UNATTENDED — do NOT use the AskUserQuestion tool. If a quarter genuinely has no capture in its filing window, log to /tmp/finalize-decisions.log as '(Q, no-capture-in-filing-window)' and skip. Never stop to ask the user."

# ====================================================================
# Phase 2: Stocks update with new Wayback fallback for delisted tickers
# ====================================================================
run_goal "STOCKS-UPDATE with Wayback fallback" \
  "/goal Follow goals/STOCKS-UPDATE.md. For any ticker that fails the primary+fallback chain in step 3, apply Phase 3.5 Wayback Machine fallback: enumerate captures via CDX API, fetch an archived stockanalysis.com history page from the ticker's mid-life, parse historical Adjusted Close monthly. Run UNATTENDED — do NOT use the AskUserQuestion tool. If even the archive returns nothing, log to /tmp/finalize-decisions.log as 'delisted-no-archive' and continue. Never stop to ask the user."

echo ""
echo "================================================================"
echo "=== finalize-base DONE: $(date)"
echo "================================================================"
echo ""
echo "Next steps:"
echo "  1. Review what changed:"
echo "       git status -s | head -30"
echo "       git diff --stat"
echo "  2. Inspect decisions / failures:"
echo "       cat /tmp/finalize-decisions.log"
echo "  3. Run verify:"
echo "       python3 /tmp/verify-backfill.py    # if the BACKFILL goal wrote one"
echo "       python3 /tmp/verify-stocks.py      # if STOCKS-UPDATE wrote one"
echo "  4. If anything off, run the postprocess:"
echo "       node scripts/postprocess-backfill.mjs"
echo "  5. When you're happy, commit (no auto-commit by this script)."
