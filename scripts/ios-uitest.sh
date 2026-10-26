#!/bin/sh
# Runs the iOS UI tests on a simulator, against the app `pnpm tauri ios dev`
# has installed there, and prints their LOG lines.
#
#   scripts/ios-uitest.sh [simulator name] [-only-testing:...]
#
# The simulator attaches the Mac's keyboard as a hardware keyboard, so iOS
# shows only the strip above where the keyboard would be. Restarting
# backboardd brings the full on-screen keyboard back, as on a phone; set
# KEEP_STRIP=1 to test with the strip instead.
set -e
here=$(cd "$(dirname "$0")/ios-uitest" && pwd)
name=${1:-iPhone 17}
[ $# -gt 0 ] && shift
udid=$(xcrun simctl list devices booted | grep -F "$name (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -n "$udid" ] || { echo "no booted simulator named $name" >&2; exit 1; }
if [ -z "$KEEP_STRIP" ]; then
  xcrun simctl spawn "$udid" defaults write com.apple.Preferences AutomaticMinimizationEnabled -bool NO
  xcrun simctl spawn "$udid" launchctl kickstart -k system/com.apple.backboardd >/dev/null 2>&1 || true
  sleep 6
fi
xcodegen generate --spec "$here/project.yml" >/dev/null
result=$(mktemp -d)/run.xcresult
status=0
xcodebuild test -project "$here/HmmChatUITests.xcodeproj" -scheme HmmChatUITests \
  -destination "id=$udid" -resultBundlePath "$result" "$@" > "$result.log" 2>&1 || status=$?
grep -E "LOG\||error: -\[|Test Case .* (passed|failed)" "$result.log" || true
echo "result bundle: $result (screenshots: xcrun xcresulttool export attachments --path $result --output-path <dir>)"
exit $status
