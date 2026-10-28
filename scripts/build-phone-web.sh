#!/bin/bash
# Builds the phone app as web pages served by the clinic server at /phone (the shared demo and the beta test build).
# The same pages work for both: the server tells the app which kind of build it is (/api/app-info).
# Run after changing the phone app:  bash scripts/build-phone-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=apps/clinic/public/phone
rm -rf apps/patient/dist "$OUT"
(cd apps/patient && EXPO_BASE_URL=/phone EXPO_PUBLIC_API_URL=same-origin EXPO_PUBLIC_DEMO=1 CI=1 npx expo export --platform web --output-dir dist --clear)
mkdir -p apps/clinic/public && cp -R apps/patient/dist "$OUT"
rm -rf apps/patient/dist

# Add to Home Screen: an app manifest and icons, so it opens full screen like an app.
cp apps/patient/assets/web/*.png "$OUT/"
cat > "$OUT/manifest.webmanifest" <<'JSON'
{
  "name": "Pumpkin",
  "short_name": "Pumpkin",
  "start_url": "/phone/",
  "scope": "/phone/",
  "display": "standalone",
  "background_color": "#F6F1E8",
  "theme_color": "#F6F1E8",
  "icons": [
    { "src": "/phone/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/phone/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/phone/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
JSON
python3 - "$OUT/index.html" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
tags = ('<link rel="manifest" href="/phone/manifest.webmanifest">'
        '<link rel="apple-touch-icon" href="/phone/apple-touch-icon.png">'
        '<meta name="apple-mobile-web-app-capable" content="yes">'
        '<meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="Pumpkin">'
        '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
        '<meta name="theme-color" content="#F6F1E8">')
s = re.sub(r"<title>.*?</title>", "<title>Pumpkin</title>", s, flags=re.S)
s = s.replace("</head>", tags + "</head>", 1)
open(p, "w").write(s)
PY
echo "Phone web app written to $OUT"
