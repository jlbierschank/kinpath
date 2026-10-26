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
- Partner side of the phone app: the partner sees only what the patient shares (cycle, injections, results), can open the injection walkthroughs to help without logging doses, and can send her private notes. Notes are triaged: an urgent symptom tells the partner to call and shows the patient a call-the-nurse card. Clinic staff never see notes. The patient switches each section on or off in Settings; care-team messages can never be shared.
- Clinic settings: result ranges, protocol answers, injection walkthroughs (order, steps, video link) and clinic urgent words, each signed by the nurse or physician who approved it, with an append-only change history. Clinic admins can view but not edit. Clinic urgent words add to the built-in list and can never remove from it.

## Next (stage 1, continued)

- [ ] Stage-aware home screen ("Others ask this on day 6") and the two-week-wait support moments from the demo
- [ ] Move internal nurse tasks (result reviews) into their own table so patients can never read them, even through the API
- [ ] AI gateway: one HIPAA-eligible model vendor behind a Kinpath service that only drafts from approved protocol sections, plus an evaluation test set with 100% urgent recall as a launch gate

- [ ] Partner screens in Spanish (after the medical translator review)

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
