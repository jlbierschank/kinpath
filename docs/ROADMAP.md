# Roadmap

## Done (stage 1, foundation)

- Monorepo with TypeScript throughout
- Safety rules with unit tests: urgent and crisis triage in English and Spanish, result labels against clinic ranges, role and partner permissions, the nurse-approved reply loop
- Postgres schema with row-level security: walls between clinics, partner section grants, a patient-only update guard, and an append-only audit log
- Synthetic seed data: two fictional clinics, staff, patients and a partner
- Web app: nurse queue, handoff detail with dose log, protocol-drafted reply, call-and-close for urgent items, pilot result entry, patient Today screen, partner view, audit log
- End-to-end browser check of the full loop

## Next (stage 1, continued)

- [ ] Patient mobile app (React Native with Expo) using the same packages
- [ ] Injection walkthroughs and dose logging from the app, with reminders
- [ ] Stage-aware home screen ("Others ask this on day 6") and the two-week-wait support moments from the demo
- [ ] Clinic settings screens: ranges, protocol sections and triage terms, each with a named approver
- [ ] Move internal nurse tasks (result reviews) into their own table so patients can never read them, even through the API
- [ ] AI gateway: one HIPAA-eligible model vendor behind a Kinpath service that only drafts from approved protocol sections, plus an evaluation test set with 100% urgent recall as a launch gate

## Before any real patient (stage 2, with a founding engineer or fractional CTO)

- [ ] Real authentication: staff single sign-on with MFA; passwordless patient and partner sign-in. Replace the dev sign-in.
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
