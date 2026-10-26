# Roadmap

## Done (stage 1, foundation)

- Monorepo with TypeScript throughout
- Safety rules with unit tests: urgent and crisis triage in English and Spanish, result labels against clinic ranges, role and partner permissions, the nurse-approved reply loop
- Postgres schema with row-level security: walls between clinics, partner section grants, a patient-only update guard, and an append-only audit log
- Synthetic seed data: two fictional clinics, staff, patients and a partner
- Web app: nurse queue, handoff detail with dose log, protocol-drafted reply, call-and-close for urgent items, pilot result entry, patient Today screen, partner view, audit log
- End-to-end browser check of the full loop
- Patient phone app (Expo): Today, injection walkthroughs, dose logging, late or missed doses, messages, urgent safety screen, Spanish
- Private dose reminders with quiet hours (tested rules in @kinpath/core) and a patient API the phone app calls
- Production-ready hosting setup (see docs/HOSTING.md): runs on managed Postgres through DATABASE_URL (tested over the real Postgres protocol), a Dockerfile with a standalone server and health check, security headers (HSTS, CSP, no-referrer, no framing), error logs without health details, a startup check that refuses unsafe production settings, and a one-time script to create a clinic and its first admin.
- Real sign-in: staff use email + password + a code from an authenticator app (required), are signed out after 30 idle minutes and after 12 hours; patients and support people use one-time codes by text or email (no password), stay signed in on their own phone, and can sign out other devices. Five wrong tries locks sign-in for 15 minutes. Support people confirm their phone or email before joining. Tokens, codes and setup links are stored only as hashes; the app role can't read credentials, sessions or the outbox. The "pick a person" demo sign-in only works in demo builds.
- Your account (profile, signature, language; password, two-step, devices; notifications) and Team for clinic admins (invite staff by setup link, change roles, deactivate, which ends access immediately; at least one admin always remains).
- Notifications: a bell and inbox on web and phone; each person picks which alerts and which channels (in app, push, text, email); quiet hours; a morning or evening summary for staff. Urgent safety alerts can be re-routed but never turned off, and skip quiet hours and summaries. Push, text and email never carry health details. Until texting and email services are connected, they land in the dev outbox.
- "When you're ready" after a negative result: a quiet link, never a push. Bayside's options (follow-up visit, frozen embryo transfer, another full cycle; nurse-editable), her embryos in storage (recorded at transfer), a private list of questions for her follow-up, and "I'm ready to talk about next steps", which puts one call on the nurse's list. The nurse sees her questions and when she said she was ready, with a reminder not to push before then.
- Graduation: after a released positive result, a nurse graduates the patient to her OB-GYN. She gets a keepsake of her journey (she can leave out any part), can thank her care team (still triaged), and can share an IVF pregnancy summary with her OB-GYN through a secure link: 7-day expiry, only the parts she picks, stoppable anytime, every view logged, only a hash of the token stored. Her support people learn her result or graduation only when she taps "Share the news."
- Two-week wait and result day: a nurse records the transfer (which cancels the remaining stimulation doses and schedules the pregnancy blood test). The patient sees "Day N of the wait" (or hides the count), picks how to hear her result (a call, the app, or a call with her partner), checks in each day, reads the clinic's approved answers, and can use "Rough day?" (talk to someone, a breathing exercise). "Struggling" or "Talk to someone" puts a call on the nurse's list. The nurse enters the hCG and chooses the outcome by hand; Pumpkin never decides it. The result stays hidden until she releases it, and release requires a phone call first if the patient asked for one. Support people never see the result. A negative result shows a gentle screen, quiets the app for 14 days (no cheerful messages or follow-up nudges; dose reminders still ring), and puts a follow-up call on the nurse's list.
- Support people: the patient invites a partner, family member or friend from Settings, picks what they see, and sends a one-time code (expires in 7 days, only its hash is stored) with her phone's share sheet. Up to five people; she can cancel an invite, change each person's access, or remove someone, which ends access right away.
- Partner side of the phone app: the partner sees only what the patient shares (cycle, injections, results), can open the injection walkthroughs to help without logging doses, and can send her private notes. Notes are triaged: an urgent symptom tells the partner to call and shows the patient a call-the-nurse card. Clinic staff never see notes. The patient switches each section on or off in Settings; care-team messages can never be shared.
- Clinic settings: result ranges, protocol answers, injection walkthroughs (order, steps, video link) and clinic urgent words, each signed by the nurse or physician who approved it, with an append-only change history. Clinic admins can view but not edit. Clinic urgent words add to the built-in list and can never remove from it.

## Next (stage 1, continued)

- [ ] OB-GYN summary links: add a short code sent separately, so a forwarded link alone isn't enough
- [ ] A real counselor directory (today "A counselor who knows this" asks the nurse to call)
- [ ] Move internal nurse tasks (result reviews) into their own table so patients can never read them, even through the API
- [x] AI drafting service: one model vendor (Anthropic, under a BAA) behind a checked gateway that only drafts from approved protocol sections; urgent triage launch gate at 100% recall. Off until turned on (see AI.md)

- [ ] Invite sign-up hardening: rate-limit code attempts, and confirm the invited person's phone or email with a one-time sign-in link
- [ ] Support-person screens in Spanish (after the medical translator review)

## Before any real patient (stage 2, with a founding engineer or fractional CTO)

- [ ] Connect a texting service and an email service (each with a signed HIPAA business associate agreement) so codes and alerts really send; real push via EAS builds
- [ ] Optional: staff single sign-on with the clinic's Microsoft or Google accounts
- [ ] Two-step reset flow for staff who lose their phone (admin-initiated)
- [ ] App Store and Google Play builds (EAS), with the clinic's branding
- [ ] Choose hosting (Aptible or AWS) and sign BAAs with hosting, texting, email and the AI vendor; then follow the checklist in docs/HOSTING.md
- [ ] Security review, penetration test, HIPAA risk assessment, policies, and a compliance platform (Vanta or Drata) started
- [ ] Clinical review of every triage term, range and protocol text by an IVF nurse and the medical director
- [ ] Medical translator review of all Spanish text
- [ ] Healthcare counsel: Florida §817.505 (flat partner fees only), FDA position on results display, state AI disclosure laws (CA, TX, LA)
- [ ] Monitoring, backups and incident response

## Records-system connection (moat)

1. Pilot: staff enter results (built)
2. Standard data feeds from the clinic's records system (results, appointments, patient details)
3. EMR partner programs: eIVF and Artisan first
4. Patient-approved uploads and outside records
