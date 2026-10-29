# Hosting Pumpkin for real patients

This is the plan for moving Pumpkin from a laptop demo to HIPAA-covered hosting. The code is ready for it; the accounts, signed agreements and reviews below are not something code can do.

**Nothing here is legal advice.** A healthcare attorney and the clinic's privacy officer should review the vendor agreements and the HIPAA risk assessment.

## What runs where

| Piece | What it is | Where it runs |
| --- | --- | --- |
| Clinic server | The clinic web app and the API the phone app calls (one Next.js server) | A container (`Dockerfile` in this repo) |
| Database | Postgres | Managed Postgres, encrypted at rest, automated backups |
| Phone app | Patients and support people | App Store and Google Play (Expo EAS builds); it talks to the clinic server over HTTPS |
| Texts | Sign-in codes and alerts | A texting service under a BAA |
| Email | Sign-in codes, setup links, alerts | An email service under a BAA |
| AI drafting | Reply drafts from approved protocols | An AI API under a BAA (see `AI.md`) |
| Push | Lock-screen alerts | Apple and Google push (via Expo), never carrying health details |

## Domain: thepumpkin.ai

| Address | What it's for |
| --- | --- |
| `thepumpkin.ai` | The company website (marketing; no patient data) |
| `<clinic>.thepumpkin.ai` (e.g. `bayside.thepumpkin.ai`) | Each clinic's nurse workspace and the API its branded phone app calls. One server can serve every clinic; the subdomain keeps each clinic's links on-brand |
| `no-reply@thepumpkin.ai` | Sender for sign-in codes, setup links and alerts. Set up SPF, DKIM and DMARC records with the email vendor so these don't land in spam |

A clinic that wants its own address (e.g. `app.baysidefertility.com`) can point it at the same server later.

## Two ways to host it

### Option A: Aptible (simplest)

Aptible is a hosting platform built for regulated health apps. Its BAA page says a signed BAA is "included with every plan," with "no separate process, no sales call," covering "your entire Aptible environment" ([Aptible](https://www.aptible.com/hipaa/baa)). It runs containers and managed databases, which is what Pumpkin needs. Check current pricing on their site.

### Option B: AWS

AWS signs a BAA through AWS Artifact. Its in-scope list includes **Amazon RDS for PostgreSQL**, **Aurora**, **ECS**, **Fargate** (ECS and EKS), **Elastic Load Balancing**, **KMS**, **CloudWatch**, **SES** (email), **SNS** and **Bedrock** ([AWS HIPAA services in scope](https://aws.amazon.com/compliance/services-in-scope/HIPAA_BAA/)). **AWS App Runner is not on that list**, so use ECS on Fargate instead. AWS says not to put health information in any service before the BAA is in place ([AWS HIPAA reference](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)).

Option B is cheaper at scale and more work to set up and run. A fractional DevOps engineer for the first setup is a good idea.

## Vendors and what we confirmed (October 2026)

Each claim below was checked on the vendor's own site. Re-check before signing; offerings change.

| Need | Vendor | BAA | Source |
| --- | --- | --- | --- |
| Hosting + Postgres | Aptible | Included on every plan | [aptible.com/hipaa/baa](https://www.aptible.com/hipaa/baa) |
| Hosting + Postgres | AWS (ECS/Fargate + RDS) | Yes, via AWS Artifact; App Runner not covered | [AWS services in scope](https://aws.amazon.com/compliance/services-in-scope/HIPAA_BAA/) |
| Texts | Twilio | Programmable SMS and Verify are listed as HIPAA eligible (list updated Sept 10, 2024) | [Twilio HIPAA eligible services (PDF)](https://twilio.com/content/dam/twilio-com/global/en/other/hippa/pdf/HIPAA-Eligible-Services.pdf) |
| Email | Paubox Email API | "Every plan includes a signed BAA," including a free tier of 300 emails a month | [paubox.com/products/email-api](https://www.paubox.com/products/email-api) |
| Email (if on AWS) | Amazon SES | Covered under the AWS BAA | [AWS services in scope](https://aws.amazon.com/compliance/services-in-scope/HIPAA_BAA/) |
| AI drafting | Anthropic Claude API | Signs a BAA for the first-party API once the org's Primary Owner signs; some API features are excluded | [Anthropic BAA article](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers) |
| AI drafting (if on AWS) | Amazon Bedrock | Covered under the AWS BAA | [AWS services in scope](https://aws.amazon.com/compliance/services-in-scope/HIPAA_BAA/) |
| Push | Expo / Apple / Google | **No BAA.** Expo: "Expo is not HIPAA-certified and does not sign BAAs," and push payloads must never contain PHI | [expo.dev/solutions/expo-healthcare](https://expo.dev/solutions/expo-healthcare) |

Pumpkin already sends no health details in push, text or email (tested in `packages/core/test/notifications.test.ts`), which is what makes the no-BAA push path workable.

**Not to use for health information:** Twilio SendGrid (not on Twilio's HIPAA eligible list), any analytics or error-tracking service without a BAA, and Anthropic API features its BAA excludes (for example Batch and Files).

## Setup checklist

1. **Sign the BAAs** with hosting, texting, email and the AI vendor *before* any real patient information goes in.
2. **Create the database**: Postgres 15 or newer, encryption at rest on, automated backups with point-in-time recovery (30 days or more), TLS required, not reachable from the internet.
3. **Set the environment** from `.env.production.example`. The server refuses to start in production without `DATABASE_URL`, without TLS on the database connection, or with any demo setting turned on.
4. **Deploy the container** (`docker build -t kinpath .`). Health check: `GET /api/health` (says only whether the app and database are up).
5. **Point a domain at it with HTTPS.** The server sends HSTS, a strict Content-Security-Policy, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer` (OB-GYN summary links carry a token).
6. **Create the first clinic and admin** (once):
   ```
   DATABASE_URL=... node apps/clinic/scripts/bootstrap.mjs \
     --clinic-id bayside --clinic-name "Bayside Fertility" \
     --admin-name "Kara Diaz" --admin-email kara@baysidefertility.com \
     --base-url https://bayside.thepumpkin.ai
   ```
   It prints a one-time link (72 hours) for the admin to set a password and two-step sign-in. The admin then invites the rest of the team from **Team**.
7. **Connect texting and email** so codes and alerts really send (the senders plug in where the dev outbox is today).
8. **Build the phone app** with EAS, pointing `EXPO_PUBLIC_API_URL` at the HTTPS domain.

## How the code maps to HIPAA's technical safeguards

| Safeguard (45 CFR 164.312) | In Pumpkin |
| --- | --- |
| Access control: unique user IDs | Every person has their own account; no shared logins |
| Access control: emergency access | To be written as a procedure (break-glass account held by the medical director) |
| Access control: automatic logoff | Staff signed out after 30 idle minutes and after 12 hours |
| Access control: encryption | Managed Postgres encryption at rest; TLS everywhere |
| Audit controls | Append-only `audit_events` (no update or delete, even for admins); views, changes, sign-ins and sharing are logged; results' values are kept out of the log |
| Integrity | Row-level security on every patient table; triggers limit which columns each role can change |
| Person or entity authentication | Staff: password + authenticator code (required). Patients: one-time codes. Support people confirm their phone or email before joining |
| Transmission security | HTTPS with HSTS; TLS to the database; no health details in push, text or email |

Minimum necessary: clinic admins see the team and audit log but no clinical records; support people see only what the patient shares; care-team messages can never be shared.

## Still to do before the first real patient

- [ ] HIPAA risk assessment, policies and procedures, workforce training (a compliance platform such as Vanta or Drata helps)
- [ ] Independent security review and penetration test
- [ ] Clinical review of every urgent word, range and protocol text by an IVF nurse and the medical director
- [ ] Medical translator review of all Spanish text
- [ ] Backup restore drill, and an incident response plan
- [ ] Log retention decision with counsel (audit logs are kept indefinitely today)
- [ ] A named technical owner (founding engineer or fractional CTO) on call for production
- [ ] Uploads (photos, PDFs, forwarded attachments): confirm the database host signs a BAA (unverified for DigitalOcean; Aptible and AWS do), and confirm the AI vendor's BAA covers reading them
- [ ] Before scale: move upload files out of the database (captures.bytes, up to 5 MB photos and 10 MB PDFs) into encrypted object storage under the same BAA (for example AWS S3), keeping only a reference in the database, so backups stay fast
