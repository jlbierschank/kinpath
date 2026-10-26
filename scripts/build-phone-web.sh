#!/bin/bash
# Builds the phone app (demo build: test-person picker on) as web pages served by the clinic server at /phone (for the shared demo).
# Run after changing the phone app:  bash scripts/build-phone-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=apps/clinic/public/phone
rm -rf apps/patient/dist "$OUT"
(cd apps/patient && EXPO_BASE_URL=/phone EXPO_PUBLIC_API_URL=same-origin EXPO_PUBLIC_DEMO=1 CI=1 npx expo export --platform web --output-dir dist --clear)
mkdir -p apps/clinic/public && cp -R apps/patient/dist "$OUT"
rm -rf apps/patient/dist
echo "Phone web app written to $OUT"
