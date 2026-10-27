# Costs, coverage and payments

Patients see what treatment will cost them, what their insurance or benefit covers, what they've paid and what's due, with receipts and ways to pay. Financial counselors run it. Pumpkin doesn't take payments yet (see `PAYMENTS.md` for the plan).

## What's in it

| Piece | Patient sees | Financial counselor does |
| --- | --- | --- |
| **Estimate** | Each line, what insurance is expected to pay, her share, and a note. Only after it's shared. | Builds a draft (up to 12 lines), then shares it. Sharing a new one replaces the old one. |
| **Coverage** | Her plan, what it covers in plain words, benefit left, cycles used, deductible and out-of-pocket progress, prior-approval status. | Enters or updates it. Only the last 4 of a member id are kept. |
| **Charges and payments** | Balance, next due date, history, and a receipt for each payment (HSA, FSA, taxes). | Records charges (with due dates), payments (with method), adjustments and refunds. Can remove a mistaken entry. |
| **Ways to pay** | The clinic's loan, grant and discount options, with links. | Counselors and admins manage the list. |
| **Questions about costs** | Asks the counselor (goes to billing, not her nurse) and sees answers. | Gets an alert, answers in plain language. |

Patients see this in the phone app (Costs card on Today, and Record → Costs) and on the web (`/patient/costs`). Counselors use **Costs** (`/money`).

## Who sees what

- **The patient:** her own, once shared.
- **Financial counselors:** every patient at their clinic, including drafts.
- **A support person:** only if she turns on "Costs and payments" in sharing (off by default), and never her questions to billing.
- **Nurses, physicians, schedulers and admins:** none of it. (Admins can manage the financing list.)
- Enforced in the database (row-level security), and tested.

## Numbers from the billing system

If costs are run in another system, they come in through the records connection (see `RECORDS.md`), so the patient has one place to plan:

- **FHIR R4:** `Coverage` (payer, plan, last 4 of the subscriber id, end date) and `Invoice` (a charge; cancelled invoices are withdrawn). Also read automatically when Pumpkin checks the FHIR API (needs `system/Coverage.rs` and `system/Invoice.rs`; skipped quietly if the server doesn't allow them).
- **HL7 v2:** `DFT^P03` (FT1-2 transaction id, FT1-4 date, FT1-6 type: CG charge, PY payment, CO co-payment, CD credit, FT1-7/8 description, FT1-11 amount) and `IN1` insurance in DFT and ADT messages (IN1-3/4 insurer, IN1-15 plan type, IN1-13 end date, IN1-36 policy number, of which only the last 4 are kept). Field positions checked on hl7.eu.
- **CSV:** `entry_id, mrn, last_name, type, description, amount, date`, plus optional `due_date, method, insurance_amount, category, estimate_id, estimate_title`. `type` is charge, payment, adjustment, refund or estimate; estimate rows with the same `estimate_id` make one estimate.

Coverage, charges and payments apply right away (the patient is told her account was updated). **Estimates arrive as drafts** for the counselor to check and share. Anything that doesn't match one patient waits on the counselor's review list, never the nurses'. Sending the same record again changes nothing.
