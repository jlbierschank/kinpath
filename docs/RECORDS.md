# Records connection

Lab results, medication orders and appointments can arrive from the clinic's records system (its EHR) instead of a nurse typing them in. There are three ways in, all with the same checks:

1. **The records system sends to Pumpkin** (HL7 v2, FHIR R4 or CSV) with a key.
2. **Pumpkin reads from the records system's FHIR API** every 15 minutes (SMART Backend Services).
3. **Someone uploads an export** on the Records connection page.

A one-page guide for the clinic's IT team, with that clinic's addresses filled in, is at **Records connection → Open the setup guide**.

## What happens to each record

| Record | What Pumpkin does |
| --- | --- |
| **Lab result** (estradiol, progesterone, LH, FSH) | Matched to the patient, labeled against the clinic's approved ranges for that stimulation day. In range: the patient sees the clinic's approved words. Anything else (out of range, no range, unexpected unit): the nurse sees it first. |
| **Pregnancy blood test** (hCG) | Fills in only the number on the patient's unreleased test. The nurse still chooses the outcome and when she hears it. If no test is waiting, it goes to the nurse's review list. |
| **New medication order** | Waits on the nurse's list. Nothing changes on the patient's schedule until a nurse confirms it; then the doses are added and the patient is told her schedule changed. |
| **Stopped order** | Waits for the nurse; confirming cancels the remaining doses. If the order was never confirmed, it's simply dropped. |
| **Corrected result** | Replaces the number, labels it again, and puts a "corrected" item in the nurse's queue. |
| **Withdrawn result** (entered in error) | Goes to the nurse to decide whether the patient needs to hear about it. |
| **Appointment** | Added to the patient's app right away (booked, rescheduled or canceled), and she's told her appointments changed. One for an unknown MRN goes to the nurse. |
| **Insurance coverage, charges and payments** | Applied to her Costs page right away, and she's told her account was updated. Ones that don't match one patient go to the financial counselor, never the nurses. See MONEY.md for the fields. |
| **Cost estimate** | Arrives as a draft for the financial counselor to check and share. |
| **Anything else** | Skipped and counted (for example tests Pumpkin doesn't track, or results that aren't final). |

**Matching is never guessed.** A record belongs to a patient only if its medical record number (MRN) matches one patient at that clinic and, when the record carries a last name, the name matches too. Otherwise it waits for a nurse, who picks the patient or dismisses it.

**Sending the same record twice changes nothing.** Every record carries its id from the records system, so retries are safe.

**Clinics stay separate.** Each key belongs to one clinic and can only reach that clinic's patients.

**Who sees what:** nurses and physicians see the clinical records; financial counselors see the billing ones. Clinic admins see the keys and an import log with counts only. Patients see results only after they've been labeled, and orders only after a nurse confirms them.

## Setting it up for a clinic

### 1. The records system sends (push)

1. A clinic admin opens **Records connection** and creates a key. It's shown once; give it to whoever sets up the feed, through a secure channel.
2. The records system (or the clinic's interface engine) sends to `https://<clinic address>/api/integrations/records` with `Authorization: Bearer <key>`:
   - **HL7 v2** (`Content-Type: x-application/hl7-v2+er7`): ORU^R01 lab results, RDE^O11 (or OMP^O09) pharmacy orders, SIU^S12–S17 appointments. Each message gets an HL7 acknowledgment (MSA AA, or AE with the reason). Times without a zone are read as the clinic's local time.
   - **FHIR R4** (`Content-Type: application/fhir+json`): a Bundle with Patient (MRN identifier with type code `MR`, name), Observation, MedicationRequest and Appointment resources.
   - **CSV** (`Content-Type: text/csv`), results only: `result_id, mrn, last_name, test, value, unit, collected_at`.
3. Up to 2,000 records or 5 MB per request. The reply lists counts only.

HL7 field positions used (v2.5.1, checked on hl7.eu): PID-3 (the identifier typed MR), PID-5; OBR-3, OBR-7; OBX-3 (LN = LOINC), OBX-5, OBX-6, OBX-11 (F final, C corrected, D/W withdrawn), OBX-14; ORC-1 (NW, XO, CA, DC, OD), ORC-2/3; RXE-2, RXE-3, RXE-5; TQ1-4, TQ1-7, TQ1-8; SCH-1/2, SCH-7, SCH-25; AIS-3, AIS-4; AIL-3.

### 2. Pumpkin reads from the FHIR API (pull)

1. On **Records connection**, the admin clicks **Set up** under "Read from the records system". Pumpkin makes a key pair for the clinic and shows its **JWK Set URL** (`/api/integrations/jwks/<clinic>`).
2. The clinic's EHR vendor registers Pumpkin as a backend service with that URL (RS384). This registration is the vendor's process; Pumpkin can't do it for them.
3. The admin enters the FHIR base URL and client id the vendor gives back (the token URL is found automatically from `.well-known/smart-configuration` when the server publishes it), turns on automatic checking, and clicks **Check now**.
4. Every 15 minutes (`KINPATH_FHIR_PULL_MINUTES`), Pumpkin finds each patient by MRN once (`Patient?identifier=`; a patient who matches more than one record there is skipped), then reads lab Observations and MedicationRequests changed since the last check, and upcoming Appointments.

Sign-in follows SMART Backend Services (checked on hl7.org): an RS384-signed JWT with `kid` and `typ: JWT`; `iss` and `sub` are the client id, `aud` the token URL, `exp` under five minutes, a unique `jti`.

The private key is stored encrypted with `KINPATH_SECRET_KEY` (32 random bytes, base64: `openssl rand -base64 32`). A production server needs it set before this can be turned on. It was tested against a stand-in records system, not a real vendor's server yet.

### 3. Upload an export

On **Records connection → Upload a file**: a CSV, a FHIR Bundle (.json), or HL7 v2 messages (.hl7 or .txt). The log shows who uploaded it.

### Patients and their MRNs

Nurses, physicians and schedulers add patients on the **Patients** screen (name, MRN, the phone or email she signs in with, language; nurses and physicians can also start her cycle). She gets a welcome with how to sign in and no health details. Staff can also book and cancel visits there.

### Lab codes (LOINC, each checked on loinc.org, October 2026)

| Code | Test | Unit |
| --- | --- | --- |
| 2243-4 | Estradiol (E2) [Mass/volume] in Serum or Plasma | pg/mL |
| 2839-9 | Progesterone [Mass/volume] in Serum or Plasma | ng/mL |
| 10501-5 | Lutropin (LH) [Units/volume] in Serum or Plasma | m[IU]/mL |
| 15067-2 | Follitropin (FSH) [Units/volume] in Serum or Plasma | m[IU]/mL |
| 21198-7 | Choriogonadotropin.beta subunit (hCG) [Units/volume] in Serum or Plasma | m[IU]/mL |
| 19080-1 | Choriogonadotropin (hCG) [Units/volume] in Serum or Plasma | m[IU]/mL |

Units are never converted. A result in an unexpected unit (for example estradiol in pmol/L) goes to the nurse.

## Trying it in the demo

Sign in as **Kara Diaz** (clinic admin), open **Records connection**, and click **Send sample records**. Then switch to **Maria Lopez, RN**: the high progesterone is in her queue, and a trigger-shot order and a result for an unknown MRN are under **From the records system**. Switch to **Maya Torres** to see tomorrow's monitoring visit. Send the sample twice to see that nothing is duplicated.

## Not built yet

- Raw MLLP (the TCP way HL7 v2 is often sent). Pumpkin takes HL7 over HTTPS; most interface engines can send that way, or a small forwarder can.
- Registering Pumpkin with specific EHR vendors (each has its own app program and approval).
- Patient demographics from the records system (new patients are added on the Patients screen).
- Clinical review: the clinic's medical director should approve which tests flow in and how the ranges are set before real patients.
