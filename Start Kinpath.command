#!/bin/bash
# Double-click this file in Finder to start Kinpath on your Mac.
# It opens two Terminal windows: the clinic side (localhost:3000) and the phone app (scan the QR code).
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"
osascript <<EOF
tell application "Terminal"
  activate
  do script "cd \"$DIR\" && git pull && pnpm install && pnpm dev:clinic"
  do script "cd \"$DIR\" && echo 'Waiting for the clinic side to start…' && until curl -s -o /dev/null http://localhost:3000; do sleep 2; done && EXPO_PUBLIC_API_URL=http://\$(ipconfig getifaddr en0 || ipconfig getifaddr en1):3000 pnpm dev:patient"
end tell
EOF
