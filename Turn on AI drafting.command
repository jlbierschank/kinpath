#!/bin/bash
# Double-click to turn AI reply drafting on or off for the demo on this Mac.
# Your API key is saved only on this Mac (apps/clinic/.env.local, never uploaded to GitHub).
cd "$(dirname "$0")" || exit 1
ENV_FILE="apps/clinic/.env.local"
MODEL="claude-sonnet-5-5"

say() { osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with title \"Pumpkin\"" >/dev/null 2>&1; }

CHOICE=$(osascript -e 'button returned of (display dialog "AI reply drafting for the demo (synthetic data only).

Turning it on needs an Anthropic API key from the Claude Console." buttons {"Cancel", "Turn off", "Turn on"} default button "Turn on" with title "Pumpkin")' 2>/dev/null) || exit 0

# Removes any earlier AI settings and keeps everything else.
clear_ai() {
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  grep -v -E '^(KINPATH_AI_PROVIDER|ANTHROPIC_API_KEY|KINPATH_AI_MODEL)=' "$ENV_FILE" > "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

if [ "$CHOICE" = "Turn off" ]; then
  clear_ai
  say "AI drafting is off. Close the clinic Terminal window and double-click Start Kinpath again for it to take effect."
  exit 0
fi

KEY=$(osascript -e 'text returned of (display dialog "Paste your Anthropic API key (it starts with sk-ant-):" default answer "" with hidden answer with title "Pumpkin")' 2>/dev/null) || exit 0
KEY=$(echo "$KEY" | tr -d '[:space:]')
if [ -z "$KEY" ]; then say "No key was pasted. Nothing changed."; exit 0; fi

# Check the key with a tiny request (the key goes in a private temp file, not on the command line).
HDR=$(mktemp); chmod 600 "$HDR"; OUT=$(mktemp)
printf 'x-api-key: %s\nanthropic-version: 2023-06-01\ncontent-type: application/json\n' "$KEY" > "$HDR"
CODE=$(curl -s -o "$OUT" -w "%{http_code}" https://api.anthropic.com/v1/messages -H @"$HDR" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK\"}]}")
rm -f "$HDR"
if [ "$CODE" != "200" ]; then
  MSG=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$OUT" | head -c 200); rm -f "$OUT"
  case "$CODE" in
    401|403) say "That key didn't work (Anthropic said it's not valid). Nothing changed." ;;
    000) say "Couldn't reach Anthropic. Check your internet connection and try again." ;;
    *) say "Anthropic returned an error ($CODE): $MSG. Nothing changed." ;;
  esac
  exit 1
fi
rm -f "$OUT"

clear_ai
printf 'KINPATH_AI_PROVIDER=anthropic\nANTHROPIC_API_KEY=%s\nKINPATH_AI_MODEL=%s\n' "$KEY" "$MODEL" >> "$ENV_FILE"
say "AI drafting is on. The key worked and is saved only on this Mac.

If Pumpkin is already running, close the clinic Terminal window and double-click Start Kinpath again."
