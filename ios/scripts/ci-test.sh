#!/bin/bash
# Runs the UI tests on one simulator against a freshly seeded server, then pulls the screenshots
# out of the result bundle. Used by .github/workflows/ios.yml after build-for-testing.
#   ios/scripts/ci-test.sh <name> <simulator id>
set -uo pipefail
NAME="$1"
SIM="$2"
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/ios-out}"
DERIVED="${DERIVED:-$PWD/.derived}"
mkdir -p "$OUT"

E2E_LOG="$OUT/server-$NAME.log" ios/scripts/e2e-server.sh || exit 1

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1 || true

rm -rf "$OUT/$NAME.xcresult"
# Run in the background under a watchdog: a simulator that never starts the tests must not hold
# the job until its timeout.
LIMIT="${TEST_LIMIT_SECONDS:-1500}"
xcodebuild test-without-building -project ios/Subspace.xcodeproj -scheme Subspace \
  -destination "id=$SIM" -derivedDataPath "$DERIVED" -resultBundlePath "$OUT/$NAME.xcresult" \
  -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 240 \
  > "$OUT/test-$NAME.log" 2>&1 &
XCB=$!
( sleep "$LIMIT"; echo "Stopped: the tests ran longer than $LIMIT seconds." >> "$OUT/test-$NAME.log"; kill "$XCB" 2>/dev/null ) &
WATCH=$!
wait "$XCB"
STATUS=$?
kill "$WATCH" 2>/dev/null || true

# What ran and how it ended, short enough to read in the job log.
grep -E "^Test (Case|Suite) .*(passed|failed|started)|error: |Executed [0-9]+ tests|\*\* TEST" "$OUT/test-$NAME.log" | grep -v "started" | awk '!seen[$0]++' | tail -150 | tee "$OUT/summary-$NAME.txt"

# Screenshots the tests attached, named as the tests named them.
SHOTS="$OUT/shots-$NAME"
rm -rf "$SHOTS" "$SHOTS.raw"
if xcrun xcresulttool export attachments --path "$OUT/$NAME.xcresult" --output-path "$SHOTS.raw" >/dev/null 2>&1; then
  mkdir -p "$SHOTS"
  python3 - "$SHOTS.raw" "$SHOTS" <<'PY'
import json, os, re, shutil, sys
raw, out = sys.argv[1], sys.argv[2]
seen = {}
for test in json.load(open(os.path.join(raw, "manifest.json"))):
    for a in test.get("attachments", []):
        src = os.path.join(raw, a.get("exportedFileName", ""))
        if not os.path.isfile(src):
            continue
        name = a.get("suggestedHumanReadableName") or a.get("exportedFileName")
        # "feed_0_ABCD-….png" -> "feed.png"
        base, ext = os.path.splitext(name)
        base = re.sub(r"_\d+_[0-9A-F-]{36}$", "", base)
        n = seen.get(base, 0)
        seen[base] = n + 1
        shutil.copy(src, os.path.join(out, f"{base}{'' if n == 0 else '-' + str(n)}{ext}"))
print(f"{sum(seen.values())} screenshots in {out}")
PY
  rm -rf "$SHOTS.raw"
  # Simulator screenshots are large; JPEG keeps the artifact small enough to open anywhere.
  for f in "$SHOTS"/*.png; do
    [ -f "$f" ] || continue
    sips -s format jpeg -s formatOptions 75 -Z 1600 "$f" --out "${f%.png}.jpg" >/dev/null 2>&1 && rm -f "$f"
  done
fi

ios/scripts/e2e-server.sh stop
xcrun simctl shutdown "$SIM" 2>/dev/null || true
exit $STATUS
