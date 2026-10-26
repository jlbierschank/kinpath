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
- "When you're ready" after a negative result: a quiet link, never a push. Bayside's options (follow-up visit, frozen embryo transfer, another full cycle; nurse-editable), her embryos in storage (recorded at transfer), a private list of questions for her follow-up, and "I'm ready to talk about next steps", which puts one call on the nurse's list. The nurse sees her questions and when she said she was ready, with a reminder not to push before then.
- Graduation: after a released positive result, a nurse graduates the patient to her OB-GYN. She gets a keepsake of her journey (she can leave out any part), can thank her care team (still triaged), and can share an IVF pregnancy summary with her OB-GYN through a secure link: 7-day expiry, only the parts she picks, stoppable anytime, every view logged, only a hash of the token stored. Her support people learn her result or graduation only when she taps "Share the news."
- Two-week wait and result day: a nurse records the transfer (which cancels the remaining stimulation doses and schedules the pregnancy blood test). The patient sees "Day N of the wait" (or hides the count), picks how to hear her result (a call, the app, or a call with her partner), checks in each day, reads the clinic's approved answers, and can use "Rough day?" (talk to someone, a breathing exercise). "Struggling" or "Talk to someone" puts a call on the nurse's list. The nurse enters the hCG and chooses the outcome by hand; Kinpath never decides it. The result stays hidden until she releases it, and release requires a phone call first if the patient asked for one. Support people never see the result. A negative result shows a gentle screen, quiets the app for 14 days (no cheerful messages or follow-up nudges; dose reminders still ring), and puts a follow-up call on the nurse's list.
- Support people: the patient invites a partner, family member or friend from Settings, picks what they see, and sends a one-time code (expires in 7 days, only its hash is stored) with her phone's share sheet. Up to five people; she can cancel an invite, change each person's access, or remove someone, which ends access right away.
- Partner side of the phone app: the partner sees only what the patient shares (cycle, injections, results), can open the injection walkthroughs to help without logging doses, and can send her private notes. Notes are triaged: an urgent symptom tells the partner to call and shows the patient a call-the-nurse card. Clinic staff never see notes. The patient switches each section on or off in Settings; care-team messages can never be shared.
- Clinic settings: result ranges, protocol answers, injection walkthroughs (order, steps, video link) and clinic urgent words, each signed by the nurse or physician who approved it, with an append-only change history. Clinic admins can view but not edit. Clinic urgent words add to the built-in list and can never remove from it.

## Next (stage 1, continued)

- [ ] OB-GYN summary links: add a short code sent separately, so a forwarded link alone isn't enough
- [ ] A real counselor directory (today "A counselor who knows this" asks the nurse to call)
- [ ] Move internal nurse tasks (result reviews) into their own table so patients can never read them, even through the API
- [ ] AI gateway: one HIPAA-eligible model vendor behind a Kinpath service that only drafts from approved protocol sections, plus an evaluation test set with 100% urgent recall as a launch gate

- [ ] Invite sign-up hardening: rate-limit code attempts, and confirm the invited person's phone or email with a one-time sign-in link
- [ ] Support-person screens in Spanish (after the medical translator review)

## Before any real patient (stage 2, with a founding engineer or fractional CTO)

- [ ] Real authentication: staff single sign-on with MFA; passwordless patient and partner sign-in. Replace the dev sign-in and the phone app's dev API header, and lock down the API's open CORS setting.
- [ ] App Store and Google Play builds (EAS), with the clinic's branding
- [ ] HIPAA-covered hosting (Aptible or AWS) and managed Postgres, with business associate agreements signed for hosting, the AI vendor, email/SMS and video
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
