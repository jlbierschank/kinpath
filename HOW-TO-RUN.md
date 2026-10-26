# How to run Kinpath on your Mac

## The easy way

In Finder, open **Documents → GitHub → kinpath** and double-click **Start Kinpath**.

It opens two Terminal windows and does everything below for you. Leave both windows open while you use the app.

> If macOS says it can't open the file, right-click it, choose **Open**, then **Open** again. You only need to do this once.

## By hand

**Terminal window 1 (the clinic side):**

```
cd ~/Documents/GitHub/kinpath && git pull && pnpm install && pnpm dev:clinic
```

Wait until it says **Ready**, then open **localhost:3000** in your browser.

**Terminal window 2 (the phone app).** Press Command-N for a new window, then paste:

```
cd ~/Documents/GitHub/kinpath && EXPO_PUBLIC_API_URL=http://$(ipconfig getifaddr en0):3000 pnpm dev:patient
```

Scan the QR code with your iPhone camera to open the app in Expo Go. Or press **w** to open it in your browser.

## Using it

**Demo sign-in.** The home page lets you pick a test person. That only works in this demo build.

**Real sign-in** (to try it like a real user):
- Staff: go to **localhost:3000/login**, use a staff email (for example `maria@bayside.example` or `kara@bayside.example`) and the demo password `bayside demo 2026`. The first time, you'll set up two-step sign-in: scan the QR code with an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or 1Password).
- Patients: in the phone app, enter `maya@example.com` and tap **Send me a code**.
- Nothing is really texted or emailed yet. Codes and alerts appear on **localhost:3000/dev/outbox** (the **Dev outbox** link in the top bar).

- **Reset demo data** (top of localhost:3000) starts everything over with the fictional patients.
- Pick who you're testing as: Maya (patient), Maria (nurse), Jordan (Maya's partner), Priya (Spanish), Kara (clinic admin).
- To switch people in the phone app, tap the initials at the top right, then **Switch test person**.

## To stop

Press **Control-C** in each Terminal window.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| `EADDRINUSE` or "port 3000 in use" | It's already running. Open localhost:3000. To start fresh, run `kill $(lsof -ti :3000)` and start again. |
| Phone says "Can't reach Bayside" | Phone and Mac must be on the same Wi-Fi. Some Wi-Fi (hotels, offices, coffee shops) blocks this: turn on your phone's Personal Hotspot and connect the Mac to it. |
| The second line prints no address | Change `en0` to `en1` and run it again. |
| Expo Go asks you to sign in | Run `npx expo login` in window 2, then run the line again. |
| `dev:patient` not found | Run `git pull && pnpm install` first. |

Everything in this build is synthetic. Never enter real patient information.

## AI reply drafting (optional)

Double-click **Turn on AI drafting** and paste an Anthropic API key. Then restart with **Start Kinpath**. Details in `docs/AI.md`.
