# AI reply drafting

The Pumpkin can use an AI model to turn the clinic's approved protocol text into a warm, plain-language reply draft. **It is off until it's turned on**, and a nurse reviews and sends every reply either way.

## The safety layers

1. **Urgent and crisis messages never reach the AI.** Rule-based triage runs first (and runs again right before drafting). Those messages go to the top of the nurse's list for a phone call. The triage launch gate (`packages/core/eval/triage-cases.json`) requires catching 100% of urgent and crisis test messages; it currently does.
2. **The AI sees as little as possible.** Only the patient's question (with emails, phone numbers and links removed) and the 1–3 approved protocol sections that match it. Never her name, record, results or medications list. If no section matches, the AI isn't called.
3. **Every draft is checked in code** (`checkAIDraft` in `packages/core/src/ai.ts`). A draft is held back if it:
   - doesn't say which protocol sections it used, or cites one it wasn't given
   - contains any number (dose, time, hours) that isn't in those sections
   - names a medication those sections don't
   - interprets results, talks about pregnancy status, diagnoses, tells her not to call, or dismisses a concern
   - is too short or too long
4. **If a draft is held back**, the nurse sees the approved protocol text instead, with the reason shown. If the AI service is slow or down, the same thing happens.
5. **Nothing the AI wrote goes in the audit log**, only how the draft was made and why one was held back.

## Turning it on for the demo (synthetic data)

The demo has no real patient information, so it can use a regular Anthropic API key:

1. In the Claude Console (console.anthropic.com), add billing credits and create an API key.
2. On the Mac, double-click **Turn on AI drafting** in the kinpath folder and paste the key into the private prompt. It checks the key with Anthropic and saves it only on that Mac (`apps/clinic/.env.local`, which is never uploaded to GitHub).
3. Close the clinic Terminal window and double-click **Start Kinpath** again. The dark bar at the top of the clinic pages says **AI drafting: on**.
4. To try it: as Maya, send "Is cramping normal?" Then as Maria, open it and choose **Draft a reply**. The draft shows **AI draft · passed every check**, or the reason it was held back.

Double-click **Turn on AI drafting** again and choose **Turn off** to go back to protocol-only drafts.

## Turning it on for real patients

Only after the Anthropic BAA is signed for the API organization (see `HOSTING.md`), using a key from that organization:

```
KINPATH_AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...                # from the HIPAA-enabled organization
KINPATH_AI_MODEL=claude-sonnet-5-5   # optional
KINPATH_AI_BAA_SIGNED=1              # the production server refuses to start with AI on without this
```

Do not use API features the BAA excludes (for example Batch and Files). The Pumpkin only uses the plain Messages API.

## Before turning it on for real patients

- [ ] An IVF nurse and the medical director review every protocol section the AI may draft from
- [ ] Run the triage launch gate and the AI tests (`pnpm -r test`) on the production build
- [ ] Review a sample of held-back and passed drafts with the nursing team during a pilot
