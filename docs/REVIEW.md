# Reviewing Pumpkin

Two places to look. Your Mac shows everything, clinic side included. The beta link shows only the
phone app, the way testers see it.

## On your Mac: clinic workspace and phone app together

1. In Finder, open **Documents → GitHub → kinpath** and double-click **Start Kinpath**. It pulls the
   latest version first. Leave both Terminal windows open.
2. When the first window says **Ready**, open **localhost:3000** in Chrome. This is the clinic side.
3. Click **Reset demo data** at the top so you start clean.
4. Click a name to sign in:
   - **Maria Lopez** (nurse): the queue, refill requests, connect requests, patient pages.
   - **Kara Diaz** (clinic admin): the audit log.
   - Both see **Pilot numbers** at the top right.
5. Open a second tab at **localhost:3000/phone**. This is the phone app.
   - **Alex Rivera**: on her own.
   - **Maya Torres**: a Bayside patient. Same app, plus a Messages tab for her care team.
   - To look at it phone-sized, press Command-Option-I, then the phone icon at the top left of the panel.
6. To use your iPhone instead, scan the QR code in the second Terminal window with the camera (Expo Go).
   The phone and Mac need the same Wi-Fi.

### Things to try

- **Refill, clinic patient.** Maya → + → Ask for a refill (or Record → Ask for a refill) → pick a medication → Send. Then Maria →
  open it in the queue → Mark handled. Maya's Messages tab shows who did it.
- **Refill, own Pumpkin.** Alex → You → Your clinic on Pumpkin → find Bayside → Ask to connect. Maria
  confirms it (pick Priya Shah's chart). Alex → Record → Ask for a refill. Maria handles it; Alex sees what
  happened under "Refills you asked for".
- **Urgent note.** In a refill note, write something like "severe pain". It goes to the queue as urgent.
- **Pilot numbers.** Maria → Pilot numbers. Switch between 7, 30 and 90 days.

## On your phone: the beta

Open **starfish-app-lurvn.ondigitalocean.app/phone**, enter the tester passcode, then **Start on my
own** and sign up with your email. Share → Add to Home Screen makes it open like an app.

There's no demo clinic, test-person picker or Reset there, so the clinic workspace and connecting to a
clinic can only be reviewed on your Mac. It updates a few minutes after each push to main.

Made-up information only, in both places.

## Same app on every device

The patient app looks and works the same on a phone, an iPad and a computer's browser: same header,
same tab bar, same cards, in one centered column. Her account is on the server, so signing in with the
same email shows the same record anywhere. On a computer with a mouse, swipes become buttons and the +
menu offers Upload instead of Camera. Dose reminders ring on her phone, through the Pumpkin app.
