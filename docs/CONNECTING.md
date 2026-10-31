# Phase 4, December items: what's built

Spec: "Pumpkin feature map - Phase 4 intelligence layer" (v1.3) in the Pumpkin project.

## 4.1 Reading documents
- Six types read into structured items (denial letters below) she checks: lab reports, med sheets, receipts, bills and
  insurance statements (explanations of benefits and benefits summaries).
- Insurance statements become **coverage** (insurer, plan, statement date, fertility benefit used and
  maximum, deductible met, out-of-pocket met). Only "you may owe" lines become bills; billed, allowed
  and plan-paid amounts never do. Coverage shows in Costs and is stored in `finance_coverage`
  (`source = 'patient'`), the same table the clinic's counselors use.
- **Where it came from:** every item keeps its source file and, from the AI reader, the page and a
  short exact quote (`capture_items.source`). The check screen shows both; saved records keep the link
  to the original file.
- **Accuracy:** a labeled test set of made-up documents (`packages/core/test/fixtures/extraction.json`,
  two per type). The basic reader must get 90% of fields right with no invented items (it does).
  The AI reader is measured with:
  `KINPATH_EVAL_AI=1 KINPATH_AI_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @kinpath/db exec vitest run test/extraction-ai.eval.test.ts`
  which writes `docs/EXTRACTION-ACCURACY.md`. Launch bar: 95% and no invented items. **Not run yet.**
  Grow the set with real-looking documents (still made up) before launch.

## 4.8 Denial letters
- A sixth document type. A letter that says a claim or prior authorization was denied becomes a
  **denial** to check, never a bill: insurer, reason (in the letter's words), what was denied, claim or
  reference number, letter date, date of service, amount denied, and the appeal deadline **only if the
  letter prints a date**. "Within 180 days" is never turned into a date; the app asks her to get it
  in writing. Stored in `insurance_denials` (her own Pumpkin only, migration 026).
- Costs shows each one with days left to the printed date, "See letter", and "I appealed" / "It's
  resolved". Copy says Pumpkin doesn't file appeals; her insurer must explain how, and her clinic's
  billing team can often help. Appeal letters (templates, not legal advice) are later.

## 4.2 Year-end packet
- Costs, For taxes and HSA/FSA: her payments for a chosen year, grouped by a best guess from each
  description (procedures, medications and pharmacy, tests and monitoring, visits, storage, donor,
  travel, other). Downloads as a PDF with each captured receipt attached and numbered, or a CSV.
  Both her own Pumpkin and clinic patients (`/api/patient/tax-packet`). Each download is audited.
- It never says what qualifies. Copy: "Your tax preparer or HSA/FSA administrator decides what
  qualifies." The PDF cites IRS Publication 502 by name only. On a phone app (not the web), the CSV
  shares as text and the PDF is a browser download for now.

## Data choices
- Research and estimates (predictions): two switches in You, for people on their own and clinic
  patients. Off by default, only she can see them, each change is time-stamped and audited
  (`data_choices`). Neither does anything yet; the copy says so.

## 4.5 Connecting layer
- **Layer 1, FHIR at the edge** (decision 5): `packages/core/src/fhir.ts` maps her record to FHIR R4:
  Patient, Observation (LOINC + UCUM), MedicationStatement (RxNorm when known), Appointment, Coverage,
  her cost entries and pregnancy dating as Pumpkin extensions on Basic, a Provenance for every item
  (patient-entered, document-extracted, clinic-sent) and the Consent each share was made under.
  `checkFhirBundle` checks required fields, references and provenance in tests. **Still to do before
  launch:** run the official HL7 validator with the US Core package (needs Java and package access).
- **Codes (before Dec 15):** every lab result gets a LOINC code on the way in (`lab_codes` + trigger).
  Five codes were checked on loinc.org in October; AMH, TSH and prolactin are marked NOT YET CHECKED.
  Every medication gets an RxNorm code from `med_codes` (+ trigger). The table is empty until
  `node scripts/rxnorm-codes.mjs > packages/db/migrations/027_med_codes.sql` is run somewhere that can
  reach NLM's RxNav (this workspace can't); review its output, then commit.
- **Tier 1 share:** You, then Send my record (and the OB handoff). She picks sections every time;
  embryo details are off by default; links last 30 days (or 7) and can be stopped; a plain warning
  about receivers outside health privacy law. The receiver gets a page, a PDF and a FHIR file, no
  account. Each view and download is audited; she's told when it's opened.
- Her own full record also downloads as FHIR (You, Download as FHIR).
