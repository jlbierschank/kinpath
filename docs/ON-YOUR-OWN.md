# Pumpkin on your own

For patients whose clinic isn't on Pumpkin (yet). She signs up herself, gets a private space, and keeps her meds, numbers, visits, costs and questions in one place. When her clinic joins, she can bring it all with her (clinic connection is next on the roadmap).

## What she can do

| | |
| --- | --- |
| **Sign up from the waitlist** | Phone or email, a one-time code, then her first name and where she is (just starting, in a cycle, two-week wait, after a hard result, freezing eggs, between cycles). Her clinic's name and after-hours number are optional. |
| **Add anything** | Take or choose a photo (instruction sheets, lab reports, portal screenshots, receipts), upload a PDF, say it, type it, or forward an email to her private address. Pumpkin reads it into proposed meds, results, visits, costs and questions. |
| **Check before it's saved** | Each item shows what Pumpkin read, with anything it wasn't sure of marked "Check this", and a link to the original. Nothing goes in her record until she taps "Add to my record". **A medication can't be added until she ticks that she checked the name, dose and time against her instructions.** |
| **Today** | Things waiting to check, tonight's (or tomorrow's) doses with "Log it", next visit, next payment, latest numbers, and "Ask my clinic to join". After a hard result, a quieter Today. |
| **Meds and reminders** | Doses are scheduled from what she confirms; reminders work the same as for clinic patients. She can stop a medication. |
| **Results** | Her own trend over time, the lab's reference range exactly as printed on her report, and what each test measures. Never "normal", "high" or "low". |
| **Visits** | Her appointments, plus a private calendar link she subscribes to once. Titles say only "Appointment" unless she turns details on, since calendars are often shared. |
| **Costs** | What's due next, payments, "paid this year" (for HSA, FSA and taxes), and the receipt photo she sent. Pumpkin doesn't take payments. |
| **Questions for my next visit** | Written any time, ticked off at the visit. |
| **Download or delete** | Download everything as a file. Delete removes her whole space (meds, results, photos, costs, support people, activity log, her waitlist entry). It can't be undone. |
| **Feeling unwell?** | Always at the top. Urgent words in anything she types or says skip reading entirely and go to her clinic's after-hours number, or 911 (988 for a crisis). Nothing is saved. |

## The safety lines

- **No verdicts on results.** Without her clinic's own ranges, Pumpkin shows what a test measures and the lab's printed range, never whether her number is good or bad. Her care team decides.
- **No silent medication changes.** AI copies what's written and lists what it couldn't read. It never guesses a name, dose or time, and she confirms every medication.
- **No nurse to route to.** Urgent symptoms go to her clinic's after-hours line or 911, not a queue.
- **Test explainers are drafts until reviewed.** The text about what each test measures (packages/core/src/solo.ts) is marked unreviewed. It only shows in demo builds until a clinical advisor signs it off (fill in `reviewedBy`).

## How it's built

- Each person gets a private space: a row in `clinics` with kind `personal`. Every existing wall (row-level security by clinic) applies unchanged; nobody else is in her space. In her own space, and only there, the database lets her add and change her own meds, results, visits and costs. In a clinic's space those still come from the clinic. Tested both ways.
- **Reading** uses the same AI vendor as drafting (`KINPATH_AI_PROVIDER=anthropic`), with photos and PDFs sent as images and documents. Without it, typed and spoken notes still work through a basic built-in reader, and photos wait for her to enter them by hand. Demo builds include three sample documents.
- **Voice:** in a browser, "Start talking" uses the browser's speech recognition. In the phone app she uses the microphone on her keyboard. Recorded voice memos (audio files) would need a transcription service under a BAA; not built.
- **Forwarded email** arrives at `/api/integrations/inbound-email` from an inbound email service (for example Cloudflare Email Workers or Postmark), posting JSON `{ to, subject, text, attachments: [{ filename, contentType, contentBase64 }] }` with the `x-pumpkin-inbound-secret` header. Off until `KINPATH_INBOUND_SECRET` is set. Anything that arrives only becomes items she must confirm, so a stranger who learns the address can't change her record.
- **Calendar feed** is `/api/integrations/calendar/<secret>`. Only a hash of the secret is stored; making a new link turns the old one off.

## Settings

| Variable | What it does |
| --- | --- |
| `KINPATH_OPEN_SIGNUP` | `1` lets anyone sign up. Unset: only people let in from the waitlist. Demo builds (`KINPATH_DEV_LOGIN=1`) are open unless this is `0`. |
| `KINPATH_FREE_AI_READS` | Free AI reads per month on the free plan (default 10). |
| `KINPATH_INBOUND_SECRET` | Turns on forwarded email. |
| `KINPATH_INBOUND_DOMAIN` | The forwarding domain shown to patients (default `in.thepumpkin.ai`). |

## Running the waitlist

```
DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs status
DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs import waitlist.csv   # the website's list, exported from Cloudflare
DATABASE_URL=... node apps/clinic/scripts/waitlist.mjs let-in 25             # next 25, oldest first
```

People who join from the app are added automatically. Everyone hears the same thing whether or not it's their turn, so the sign-up screen can't be used to find out who is on Pumpkin.

## Privacy and law (for counsel)

A patient's own entries outside a clinic relationship aren't covered by HIPAA through a clinic. The FTC's Health Breach Notification Rule (expanded to health apps in 2024) and state laws such as Washington's My Health My Data Act apply instead. Counsel should review consent wording, the sign-up flow and the breach plan before real patients use it.

## Decisions and what's next

- **Free AI reads (decided):** everyone on their own gets a set number of AI reads each calendar month (default 10, `KINPATH_FREE_AI_READS`) so they feel the benefit. The Add screen shows how many are left. When they're used up, typed and spoken notes still work through the basic reader, and anything can be added by hand. Samples and failed reads don't count. Premium (`plan = 'premium'`, the $4.99 tier in the financial model) has no monthly limit; buying it in the app isn't built yet. Download and delete are never limited.
- **Community** is next to build, with moderation designed in (adults only, handles not names, no private messages at first, 988 crisis path, medical advice flagged back to the care team).

## Not built yet

Connecting a clinic and moving her space into it; reading results straight from a patient portal (SMART on FHIR patient access); linking a bank account (Plaid); two-way Google or Outlook calendar; recorded voice memos; support-person invites from the on-your-own app (the server supports them); Spanish for this part of the app.

## Try it in the demo

Phone app → pick **Alex Rivera** (on her own; her clinic isn't on Pumpkin). Check the two things waiting, add a sample lab report, look at Record and Costs, and tap "Feeling unwell?". Or sign out, choose **Start on my own**, and sign up with any email (the code is on the clinic site's Dev outbox page).
