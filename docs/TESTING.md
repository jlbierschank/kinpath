# The beta test build

A second copy of Pumpkin for you and the people you invite to try it on their own phones, before launch.
It is plain Pumpkin: no demo clinic, no test-person picker, no "Reset demo data". People sign up with
their own email and keep what they add.

**Made-up information only** until counsel, the vendor BAAs and the clinical review are done. Every
screen says so.

## What testers can do

- Open the link on their phone, enter the passcode, and tap Share → **Add to Home Screen**. It opens
  full screen with the Pumpkin icon, like an app.
- Start on their own, add things (photo, PDF, typed, said), check them, see Today, Record, Costs.
- Invite their person (Settings → Your people), who joins with a code and sees only what's switched on.
- Ask their clinic to join; Pumpkin's team gets an email with the clinic's name only, and the tester
  gets a note they can send their clinic.
- Send feedback (Settings → Send feedback). It's emailed to the team and kept.

Dose reminders on the phone need the TestFlight app (Apple), not the web version. The calendar link
works on both.

## Set it up (DigitalOcean, about 30 minutes)

1. **Email sending.** Make a free account at resend.com, add and verify the domain thepumpkin.ai
   (it shows DNS records to add), and create an API key.
2. **Database.** In DigitalOcean: Create → Databases → PostgreSQL, the smallest size, same region as
   the app. Copy its connection string (it ends in `sslmode=require`).
3. **The app.** Create → App Platform → the same GitHub repo and `main` branch, 1 GiB size. Settings:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the connection string from step 2 |
   | `KINPATH_TEST_MODE` | `1` |
   | `KINPATH_DEMO_PASSCODE` | a passcode for testers |
   | `KINPATH_EMAIL_PROVIDER` | `resend` |
   | `KINPATH_EMAIL_KEY` | the Resend API key |
   | `KINPATH_EMAIL_FROM` | `Pumpkin <hello@thepumpkin.ai>` |
   | `KINPATH_TEAM_EMAIL` | where feedback and "ask my clinic" emails go |
   | `KINPATH_AI_PROVIDER` / `ANTHROPIC_API_KEY` | optional: turns on AI reading of photos and PDFs |

   Do **not** set `KINPATH_DEV_LOGIN` here. Optional: add `beta.thepumpkin.ai` under Settings → Domains.
4. Open the address, enter the passcode, and sign up yourself first.

Texts (Twilio) are optional for testing; testers can sign in by email. To add them later:
`KINPATH_SMS_PROVIDER=twilio`, `KINPATH_TWILIO_SID`, `KINPATH_TWILIO_TOKEN`, `KINPATH_SMS_FROM`.

## Before real patients

The test build starts without signed BAAs. Real launch turns `KINPATH_TEST_MODE` off, and then the
server refuses to start until `KINPATH_MESSAGING_BAA_SIGNED=1` and `KINPATH_AI_BAA_SIGNED=1` say the
vendor agreements are signed. Testers' accounts can be deleted from inside the app (Settings → Delete
my account).
