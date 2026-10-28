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

## Set it up (about 45 minutes, most of it waiting)

### 1. Email for sign-in codes (Resend, free)

1. Go to **resend.com** and sign up.
2. **Domains → Add Domain**, type `thepumpkin.ai`, pick the US region.
3. Resend shows a few DNS records (a TXT for DKIM, and an MX and a TXT on a `send` subdomain). If it
   offers to set them up in Cloudflare for you, use that. Otherwise open Cloudflare → thepumpkin.ai →
   **DNS → Add record** and copy each one exactly, with the proxy turned **off** (grey cloud, "DNS only").
4. Back in Resend, click **Verify**. It can take a few minutes to an hour.
5. **API Keys → Create API Key**, permission "Sending access". Copy the key (it starts with `re_`); you
   only see it once.

### 2. The database (DigitalOcean)

1. In DigitalOcean: **Create → Databases → PostgreSQL**, the smallest size, region **New York**.
   Name it `pumpkin-beta`. Check the monthly price it shows before you click Create.
2. Wait until it says it's ready (a few minutes).

### 3. The tester app (DigitalOcean)

1. **Create → App Platform → GitHub**, repo **jlbierschank/kinpath**, branch **main**, Autodeploy on.
2. Size **1 GiB** ($10 fixed size), 1 instance, region New York.
3. **Add Resource → Database → Previously created DigitalOcean database** → `pumpkin-beta`. This lets the
   app reach the database and fills in its address and certificate.
4. Environment variables on the web service (tick **Encrypt** on the key ones):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | `${pumpkin-beta.DATABASE_URL}` |
   | `DATABASE_CA_CERT` | `${pumpkin-beta.CA_CERT}` |
   | `PORT` | `8080` |
   | `KINPATH_TEST_MODE` | `1` |
   | `KINPATH_DEMO_PASSCODE` | a passcode for testers |
   | `KINPATH_EMAIL_PROVIDER` | `resend` |
   | `KINPATH_EMAIL_KEY` | the Resend key (encrypt) |
   | `KINPATH_EMAIL_FROM` | `Pumpkin <hello@thepumpkin.ai>` |
   | `KINPATH_TEAM_EMAIL` | where feedback and "ask my clinic" emails go |
   | `KINPATH_AI_PROVIDER` and `ANTHROPIC_API_KEY` | optional: AI reading of photos and PDFs |

   Do **not** set `KINPATH_DEV_LOGIN` on this app.
   If the `${...}` values don't fill in, copy the connection string from the database's page into
   `DATABASE_URL`, and paste the downloaded CA certificate into `DATABASE_CA_CERT`.
5. **Create Resources.** The first build takes several minutes.
6. Optional: **Settings → Domains → Add** `beta.thepumpkin.ai`, then add the CNAME it shows in Cloudflare.

### 4. Try it, then invite testers

1. On your phone, open the address with `/phone` on the end, enter the passcode, tap **Start on my own**
   and sign up with your email. The code should arrive within a minute (check spam the first time).
2. Safari: Share → **Add to Home Screen**. Android Chrome: menu → **Add to Home screen**.
3. Send testers the `/phone` link, the passcode, and one line: "Use made-up information only."
4. Feedback arrives at your team email. Testers can delete their accounts in Settings.

If sign-up says it can't send, check the app's **Runtime Logs** for a line from "sender".

## Before real patients

The test build starts without signed BAAs. Real launch turns `KINPATH_TEST_MODE` off, and then the
server refuses to start until `KINPATH_MESSAGING_BAA_SIGNED=1` and `KINPATH_AI_BAA_SIGNED=1` say the
vendor agreements are signed. Testers' accounts can be deleted from inside the app (Settings → Delete
my account).
