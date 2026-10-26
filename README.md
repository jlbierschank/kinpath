# Kinpath

A clinic-branded patient app and nurse workspace for fertility clinics ("Bayside Fertility, powered by Kinpath").

> **Synthetic data only.** This build has development sign-in and an embedded database. No real patient information may be entered until the items in [docs/ROADMAP.md](docs/ROADMAP.md) under "Before any real patient" are done.

## What works today

- **The missed-dose loop:** the patient reports a missed dose. It lands in the nurse's queue with her dose log attached. The nurse gets a reply drafted from the clinic's approved protocol, edits it if needed, and sends it. The patient sees "Drafted with Kinpath, reviewed by Maria."
- **Urgent symptoms skip the AI:** messages that mention things like breathing trouble or heavy bleeding (English or Spanish) jump to the top of the queue, and the app never drafts a reply to them. A nurse calls the patient instead.
- **Results against the clinic's own ranges:** in-range results show the clinic's nurse-approved explanation. Anything else shows "your nurse will review this with you" and opens a nurse task.
- **Partner sharing:** the patient's partner sees only the sections she shares. Patient-nurse messages are never shared with the partner.
- **Clinic walls and audit log:** clinics can't see each other's data, enforced by the database itself. Every view and change is logged, and the log can't be edited or deleted.
- **Spanish:** drafts and the patient view follow the patient's language. The Spanish text is a placeholder until a medical translator reviews it.

## Run it

You'll need Node 22 and pnpm.

```bash
pnpm install
pnpm test                 # 40+ safety and access tests
pnpm dev:clinic           # http://localhost:3000
```

Pick a person on the home screen, for example Maya (patient) or Maria (nurse), and try the loop. "Reset demo data" starts over.

## Layout

| Folder | What it is |
| --- | --- |
| `packages/core` | Safety rules as plain, tested code: urgent triage, result labels, permissions, the reply loop |
| `packages/db` | Postgres schema with row-level security, synthetic seed data, data operations for the loop |
| `apps/clinic` | Next.js web app: nurse workspace plus simple patient, partner and admin screens |
| `docs` | Roadmap and safety notes |

## Ground rules

1. **Safety decisions live in code, not in the AI.** Triage, result labels and permissions are deterministic and tested.
2. **The AI drafts and a nurse decides.** Nothing clinical reaches a patient without a nurse or physician sending it.
3. **Authorization tests must pass before anything merges.** These cover clinic walls, partner limits and the audit log.
4. **No real patient data in development, in prompts or in AI coding tools.**
5. **Clinical content is a placeholder.** An IVF nurse and the clinic's medical director must own the triage terms, ranges and protocol text.
