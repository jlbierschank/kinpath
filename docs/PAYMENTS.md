# Plan: paying in the app (future)

Today Pumpkin shows estimates, coverage, charges, payments and receipts, but payments are made through the clinic's billing office (or arrive from its billing system). This is the plan for letting patients pay inside Pumpkin. **Nothing here is built yet, and nothing here is legal advice.** Have healthcare counsel review it before building.

Research checked on primary sources on October 26, 2026. Anything not confirmed on the company's own site is marked **unverified**.

## What patients would be able to do

1. Pay a balance or a deposit with a card or bank account.
2. Set up a payment plan (for example, the cycle balance in three monthly payments) that charges automatically.
3. Save a card for the plan, see upcoming plan charges, and change or cancel them.
4. Get a receipt in the app right away (receipts already exist; a payment would create one).
5. Apply for financing or a grant from the clinic's list (already built as links; deeper integration later).

## HIPAA: who needs a business associate agreement (BAA)

- HHS says that when a financial institution processes card payments, checks or electronic funds transfers "for payment for health care," it "is not performing a function or activity for, or on behalf of, the covered entity" ([HHS: Business associates](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/business-associates/index.html)). In other words, a vendor that **only moves money** isn't a business associate for that.
- HHS also lists **billing and practice management** as business associate functions, and says an app developer that handles patients' health information for a covered entity is a business associate (same page). So **Pumpkin is a business associate of each clinic** (already planned), and a payment vendor that also sends statements, runs billing or hosts a patient portal probably is one too.
- Stripe's own guide notes a payment that carries a patient's name together with diagnosis information is protected health information ([Stripe: healthcare embedded payments](https://stripe.com/resources/more/healthcare-embedded-payments)).

**Design rule that follows:** Pumpkin keeps the statements, estimates and receipts, and sends the payment company only what it needs to move money: the amount, the clinic, and a generic description ("Bayside Fertility payment"), never the treatment, a diagnosis or line items. We should still prefer a vendor that will sign a BAA.

## Payment companies to consider

| Company | What its own site says | Not confirmed |
| --- | --- | --- |
| **Stripe** | PCI Service Provider Level 1 ([docs](https://docs.stripe.com/security)); payment plans and scheduled payments ([payment plans](https://docs.stripe.com/invoicing/payment-plans), [subscription schedules](https://docs.stripe.com/billing/subscriptions/subscription-schedules)); restricts telehealth, prescriptions and online pharmacies, and doesn't list fertility as restricted ([restricted businesses](https://stripe.com/legal/restricted-businesses)) | Whether Stripe signs a BAA (**unverified**: no Stripe page says either way; ask Stripe sales) |
| **Square** | A HIPAA BAA built into its terms, covering Square Appointments, Invoices and features Square marks as HIPAA-enabled; "not all Services are HIPAA-enabled" ([Square HIPAA](https://squareup.com/us/en/legal/general/hipaa), [help](https://squareup.com/help/us/en/article/5091-hipaa-compliance)); recurring payments via Virtual Terminal ([healthcare](https://squareup.com/us/en/solutions/healthcare)) | PCI Level 1 and built-in payment plans (**unverified**) |
| **InstaMed** (J.P. Morgan) | Owned by JPMorgan Chase Bank; HIPAA compliant; PCI Level One service provider ([compliance](https://www.instamed.com/compliance-and-security/)); patient portal and "Pay Over Time" plans ([patient payments](https://www.instamed.com/providers/patient-billing-and-payment-solutions/)) | BAA terms (**unverified**) |
| **Rectangle Health** | Lists fertility as a specialty; PCI Level 1 service provider; recurring payment plans; financing through Health Finance Direct ([FAQ](https://www.rectanglehealth.com/faqs/), [payments and financing](https://www.rectanglehealth.com/platform/bridge-payments-and-financing)) | BAA (**unverified**) |
| **Payabli** | PCI DSS Level 1 ([trust center](https://docs.payabli.com/trust-center)); recurring and autopay ([docs](https://docs.payabli.com/guides/pay-in-overview)) | Healthcare offering and BAA (**unverified**) |

**Recommendation to explore first:** a healthcare-focused processor that signs a BAA and already serves fertility clinics (Rectangle Health or InstaMed), or Stripe if it confirms a BAA in writing. Many clinics already have a processor; supporting "use the clinic's existing account" may matter more than our choice.

## How it would work

1. **The clinic is the merchant.** Each clinic connects its own payment account; money goes straight to the clinic. Pumpkin never holds patient money.
2. **Pumpkin never sees card numbers.** The payment company's hosted payment form or embedded fields collect the card, so Pumpkin stays in the smallest PCI scope (the processor handles card data).
3. **The payment company tells Pumpkin when a payment succeeds** (a signed webhook). Pumpkin adds it to the patient's account with a receipt, and sends it to the clinic's billing system through the records connection.
4. **Payment plans** are scheduled charges at the payment company. Pumpkin shows the schedule and sends reminders without health details ("A payment is coming up").
5. **Refunds and disputes** are handled by the clinic's billing office in the payment company's dashboard and flow back to Pumpkin.

## Decisions for you

- Which payment company (or companies) to support first, after confirming BAA terms in writing.
- Whether Pumpkin earns anything on payments. **Ask healthcare counsel first**: Florida's patient brokering law (§817.505) is already on the roadmap for partner fees, and payment fees raise similar questions.
- Whether financing partners get a deeper integration (pre-qualification inside the app) or stay as links.

## Financing and grants clinics could list

The demo uses made-up partners. Real ones, as described on their own sites (each clinic decides whom to list and checks current terms):

- **CapexMD:** fertility loans from $3k to $60k for IVF, IUI, egg freezing and surrogacy fees; a free clinic program with the clinic's logo and brochures ([site](https://www.capexmd.com/), [providers](https://www.capexmd.com/providers.htm))
- **Future Family:** up to $50k for fertility, with a provider portal and a partner estimate calculator ([site](https://www.futurefamily.com/), [partners](https://partners.futurefamily.com/))
- **Prosper Healthcare Lending:** IVF financing up to $50k (loans made by WebBank) ([site](https://www.prosper.com/personal-loans/healthcare-financing/fertility-ivf))
- **Baby Quest Foundation** grants, spring and fall cycles ([apply](https://babyquestfoundation.org/applying-for-a-grant))
- **Tinina Q. Cade Foundation:** up to $10k ([family grant](https://cadefoundation.org/familygrant))
- **Gift of Parenthood:** up to $20k, paid directly to the provider ([grant program](https://give.giftofparenthood.org/grant-program))
