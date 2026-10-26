# Records connection

Lab results and medication orders can arrive from the clinic's records system (its EHR) instead of a nurse typing them in.

## What happens to each record

| Record | What Pumpkin does |
| --- | --- |
| **Lab result** (estradiol, progesterone, LH, FSH) | Matched to the patient, labeled against the clinic's approved ranges for that stimulation day. In range: the patient sees the clinic's approved words. Anything else (out of range, no range, unexpected unit): the nurse sees it first. |
| **Pregnancy blood test** (hCG) | Fills in only the number on the patient's unreleased test. The nurse still chooses the outcome and when she hears it. If no test is waiting, it goes to the nurse's review list. |
| **New medication order** | Waits on the nurse's list. Nothing changes on the patient's schedule until a nurse confirms it; then the doses are added and the patient is told her schedule changed. |
| **Stopped order** | Waits for the nurse; confirming cancels the remaining doses. If the order was never confirmed, it's simply dropped. |
| **Corrected result** | Replaces the number, labels it again, and puts a "corrected" item in the nurse's queue. |
| **Withdrawn result** (entered in error) | Goes to the nurse to decide whether the patient needs to hear about it. |
| **Anything else** | Skipped and counted (for example tests Pumpkin doesn't track, or results that aren't final). |

**Matching is never guessed.** A record belongs to a patient only if its medical record number (MRN) matches one patient at that clinic and, when the record carries a last name, the name matches too. Otherwise it waits for a nurse, who picks the patient or dismisses it.

**Sending the same record twice changes nothing.** Every record carries its id from the records system, so retries are safe.

**Clinics stay separate.** Each key belongs to one clinic and can only reach that clinic's patients.

**Who sees what:** nurses and physicians see the records. Clinic admins see the keys and an import log with counts only. Patients see results only after they've been labeled, and orders only after a nurse confirms them.

## Setting it up for a clinic

1. A clinic admin opens **Records connection** and creates a key. It's shown once; give it to whoever sets up the feed, through a secure channel.
2. The records system (or the clinic's interface engine) sends records to `https://<clinic address>/api/integrations/records` with `Authorization: Bearer <key>`.
3. Formats:
   - **FHIR R4** (`Content-Type: application/fhir+json`): a Bundle with Patient (MRN identifier with type code `MR`, name), Observation and MedicationRequest resources.
   - **CSV** (`Content-Type: text/csv`), results only: `result_id, mrn, last_name, test, value, unit, collected_at`. `test` can be a LOINC code or a name (estradiol, progesterone, LH, FSH, hCG).
4. The reply lists counts only. Up to 2,000 records or 5 MB per request.
5. Each patient's MRN must be in Pumpkin (it's on the patient record).

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

Sign in as **Kara Diaz** (clinic admin), open **Records connection**, and click **Send sample records**. Then switch to **Maria Lopez, RN**: the high progesterone is in her queue, and a trigger-shot order and a result for an unknown MRN are under **From the records system**. Send the sample twice to see that nothing is duplicated.

## Not built yet

- Many records systems send lab results as HL7 v2 messages rather than FHIR. Until Pumpkin reads HL7 v2 directly, an interface engine can translate them to FHIR or CSV.
- Reading from a records system's own FHIR API (Pumpkin asking, rather than the records system sending) needs an app registration with each EHR vendor.
- Appointments and patient details (new patients, demographics) still come in by hand.
- Clinical review: the clinic's medical director should approve which tests flow in and how the ranges are set before real patients.
