#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# register-offerings.sh — register EVERY CUSTOS ACP offering (and the Resource)
# in one shot, instead of running `acp offering create` ~38 times by hand.
#
# Prereqs (see ACP.md):
#   • acp CLI installed and logged in
#   • the CUSTOS agent selected:   acp agent use
#
# Usage:
#   scripts/register-offerings.sh             # emit fresh JSON, then register all
#   scripts/register-offerings.sh --no-emit   # register the existing JSON as-is
#   scripts/register-offerings.sh --dry-run   # list what would be registered
#   DELAY=1 scripts/register-offerings.sh     # seconds between calls (default 0.4)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1          # run from the repo root

EMIT=1; DRY=0
for a in "$@"; do
  case "$a" in
    --no-emit) EMIT=0 ;;
    --dry-run) DRY=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^#\{1,\} \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $a  (try --help)"; exit 1 ;;
  esac
done
DELAY="${DELAY:-0.4}"

# Resolve the acp CLI (global first, then npx).
if command -v acp >/dev/null 2>&1; then ACP="acp"
elif command -v npx >/dev/null 2>&1; then ACP="npx acp"
else echo "✗ acp CLI not found. Install it and run 'acp agent use' first (see ACP.md)."; exit 1; fi

# An agent must be selected before offerings can be created.
if [ "$DRY" -eq 0 ] && ! $ACP agent whoami >/dev/null 2>&1; then
  echo "✗ No ACP agent selected. Run:  acp agent use   (see ACP.md)"; exit 1
fi

# 1) Emit fresh offering.json from the catalog (src/acp/offerings.ts) unless --no-emit.
if [ "$EMIT" -eq 1 ] && [ "$DRY" -eq 0 ]; then
  echo "→ emitting offering.json from src/acp/offerings.ts …"
  npm run acp:offerings --silent || { echo "✗ emit failed"; exit 1; }
fi

# 2) Register every offering.json + resource.json under src/acp/serve/.
TOTAL=$(find src/acp/serve \( -name offering.json -o -name resource.json \) | wc -l | tr -d ' ')
echo "→ ${TOTAL} definitions found (offerings + resources)"; echo

OK=0; FAIL=0; i=0; FAILED=""
while IFS= read -r f; do
  i=$((i+1))
  id="$(basename "$(dirname "$f")")"
  kind="offering"; [ "$(basename "$f")" = "resource.json" ] && kind="resource "
  printf "[%2d/%2d] %s %-34s " "$i" "$TOTAL" "$kind" "$id"
  if [ "$DRY" -eq 1 ]; then echo "(dry-run) $f"; continue; fi
  if out=$($ACP offering create --from-file "$f" 2>&1); then
    echo "✓"; OK=$((OK+1))
  else
    echo "✗"; FAIL=$((FAIL+1)); FAILED="${FAILED}  ${f}\n"
    echo "        └─ $(printf '%s' "$out" | tail -n1)"   # last line of the error
  fi
  sleep "$DELAY"
done < <(find src/acp/serve \( -name offering.json -o -name resource.json \) | sort)

echo
echo "──────────────────────────────────────────────"
echo "registered: ${OK}   failed: ${FAIL}   total: ${TOTAL}"
if [ "$FAIL" -gt 0 ]; then
  echo -e "failed:\n${FAILED}(an 'already exists' error is safe to ignore — that offering is already live.)"
  exit 1
fi
echo "✓ all offerings registered."
