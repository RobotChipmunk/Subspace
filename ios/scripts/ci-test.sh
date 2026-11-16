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
# A simulator that has only just booted is still busy with its own first-run work, and the first
# tests time out against it. Give it a moment before driving the app.
sleep "${SIM_SETTLE_SECONDS:-45}"

rm -rf "$OUT/$NAME.xcresult"
# Run in the background under a watchdog: a simulator that never starts the tests must not hold
# the job until its timeout.
LIMIT="${TEST_LIMIT_SECONDS:-1800}"
xcodebuild test-without-building -project ios/Subspace.xcodeproj -scheme Subspace \
  -destination "id=$SIM" -derivedDataPath "$DERIVED" -resultBundlePath "$OUT/$NAME.xcresult" \
  -parallel-testing-enabled NO -test-timeouts-enabled YES -default-test-execution-time-allowance 240 \
  -retry-tests-on-failure -test-iterations 2 \
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
        if name.startswith("Debug description"):
            continue
        # artifact uploads refuse these characters
        name = re.sub(r'[":<>|*?\r\n/\\`]', "", name)
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

# When an expectation failed the test attached what the app was showing, as text. Print the
# named elements of each, short enough for the job log, so a failure can be read without the artifact.
for f in "$SHOTS"/hierarchy*; do
  [ -f "$f" ] || continue
  echo "---- on screen at a failed expectation: $(basename "$f")"
  grep -E "identifier: '|label: '" "$f" | sed -E 's/^ +//; s/0x[0-9a-f]+, //' | cut -c1-170 | head -80
done
# What the server said while the tests ran, when it complained.
grep -iE "error|unhandled|ECONN| 5[0-9][0-9] " "$OUT/server-$NAME.log" 2>/dev/null | cut -c1-200 | awk '!seen[$0]++' | tail -20

ios/scripts/e2e-server.sh stop
xcrun simctl shutdown "$SIM" 2>/dev/null || true
exit $STATUS
