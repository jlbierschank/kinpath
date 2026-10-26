# Kinpath

A clinic-branded patient app and nurse workspace for fertility clinics ("Bayside Fertility, powered by Kinpath").

> **Synthetic data only.** This build has development sign-in and an embedded database. No real patient information may be entered until the items in [docs/ROADMAP.md](docs/ROADMAP.md) under "Before any real patient" are done.

## What works today

- **The missed-dose loop:** the patient reports a missed dose. It lands in the nurse's queue with her dose log attached. The nurse gets a reply drafted from the clinic's approved protocol, edits it if needed, and sends it. The patient sees "Drafted with Kinpath, reviewed by Maria."
- **Urgent symptoms skip the AI:** messages that mention things like breathing trouble or heavy bleeding (English or Spanish) jump to the top of the queue, and the app never drafts a reply to them. A nurse calls the patient instead.
- **Results against the clinic's own ranges:** in-range results show the clinic's nurse-approved explanation. Anything else shows "your nurse will review this with you" and opens a nurse task.
- **Two-week wait and result day:** a nurse records the transfer, and the patient's app becomes the wait: the blood test date, how she wants to hear her result, a daily check-in, the clinic's answers, and a "Rough day?" option. The nurse decides the outcome and releases it; if the patient asked for a call, the app won't release it until the nurse confirms she called. Support people never see the result. After a negative result the app goes quiet for 14 days and a follow-up call lands on the nurse's list.
- **Support people:** in Settings, the patient invites a partner, family member or friend, picks what they'll see, and texts them a one-time code. She can change each person's access or remove them at any time.
- **Partner sharing:** the patient's partner signs in to the same phone app and sees only the sections she shares: her cycle, tonight's injections (with the walkthroughs, so he can help), and results if she turns them on. He can send her private notes the clinic never sees; a note that mentions an urgent symptom tells him to call the nurse line and shows her a call-the-nurse card. Patient-nurse messages are never shared.
- **Clinic walls and audit log:** clinics can't see each other's data, enforced by the database itself. Every view and change is logged, and the log can't be edited or deleted.
- **Spanish:** drafts and the patient view follow the patient's language. The Spanish text is a placeholder until a medical translator reviews it.
- **Patient phone app (Expo, iPhone and Android):** a Today screen; step-by-step injection walkthroughs written and approved by the clinic's nurses, with a "first one done" moment; one-tap dose logging; "took it late" or "missed it" for unlogged doses; messages to the care team; and the urgent-symptom safety screen.
- **Clinic settings:** nurses and physicians edit the clinic's result ranges, protocol answers, injection walkthroughs (order, steps, video) and extra urgent words. Each change is signed with their name and kept in a change history that can't be edited. Clinic admins can look but not change anything, and the built-in urgent words can't be removed.
- **Private reminders:** dose reminders 15 minutes early that never get silenced, and "did you log it?" follow-ups that wait out quiet hours. The lock screen says only "You have a reminder" unless the patient chooses to show medication names.

## Run it

You'll need Node 22 or newer and pnpm.

```bash
pnpm install
pnpm test                 # 106 safety, settings, sharing, result and access tests
pnpm dev:clinic           # http://localhost:3000
```

Pick a person on the home screen, for example Maya (patient) or Maria (nurse), and try the loop. "Reset demo data" starts over.

### The phone app

With the server running (`pnpm dev:clinic`), open a second Terminal window:

```bash
pnpm dev:patient
```

- **On your computer:** press `w` to open it in the browser. Reminders only work on a phone.
- **On your phone:** install **Expo Go** from the App Store or Google Play and scan the QR code Terminal shows. Your phone and computer must be on the same Wi-Fi. Because the phone can't reach "localhost", start it like this instead, using your computer's local IP address (System Settings, then Wi-Fi, then Details):

  ```bash
  EXPO_PUBLIC_API_URL=http://192.168.1.23:3000 pnpm dev:patient
  ```

## Layout

| Folder | What it is |
| --- | --- |
| `packages/core` | Safety rules as plain, tested code: urgent triage, result labels, permissions, the reply loop |
| `packages/db` | Postgres schema with row-level security, synthetic seed data, data operations for the loop |
| `apps/clinic` | Next.js web app: nurse workspace, simple patient, partner and admin screens, and the API the phone app uses |
| `apps/patient` | Expo (React Native) phone app for patients |
| `docs` | Roadmap and safety notes |

## Ground rules

1. **Safety decisions live in code, not in the AI.** Triage, result labels and permissions are deterministic and tested.
2. **The AI drafts and a nurse decides.** Nothing clinical reaches a patient without a nurse or physician sending it.
3. **Authorization tests must pass before anything merges.** These cover clinic walls, partner limits and the audit log.
4. **No real patient data in development, in prompts or in AI coding tools.**
5. **Clinical content is a placeholder.** An IVF nurse and the clinic's medical director must own the triage terms, ranges and protocol text.
