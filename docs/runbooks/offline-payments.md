# Recording offline payments

Workspaces pay by bank transfer against a DealFlow invoice (ADR 0013). An operator with the **ADMIN** role records
each payment.

## Before the first invoice: enter the bank details

1. Sign in to the operator console (`/operator`) as an **ADMIN** operator and open **Settings**.
2. Under **Payment instructions**, enter what payers need: bank name, account name, account number, IFSC or SWIFT
   code, and "quote the invoice number as the payment reference". Line breaks are kept. Save.
3. Every invoice waiting for payment shows the text at once; no redeploy is needed. The page also shows exactly
   what workspaces see. Each change is written, with the full text, to the operator log, so a changed account
   number can always be traced.

Until this is set, invoices say the DealFlow team will send payment details. To check a change was not made by
someone else, look for `settings.payment_instructions_updated` in the operator log.

## Recording a payment

1. Sign in to the operator console (`/operator`). **Waiting for payment** lists every open invoice with its
   workspace, number, plan, seats and amount.
2. Match the bank credit to the invoice by the number the payer quoted (`DF-…`) and check the **full amount** has
   arrived. For a partial or wrong amount, do not mark it paid: contact the workspace, and void the invoice if a
   different one is needed (the workspace can then request a new one).
3. Open the workspace, enter the bank or transfer reference (UTR, SWIFT reference) and the day the money arrived,
   and choose **Mark paid**. The plan starts (or renews from the end of the current period), the workspace's billing
   managers are notified, and the action is written to both audit logs.
4. Issue any tax invoice Sampledge's accounting requires outside DealFlow.

Settings: the console value wins. `OFFLINE_PAYMENT_INSTRUCTIONS` (deployment config, `\n` for line breaks) is only a
fallback for when nothing is saved in the console. `ONLINE_PAYMENTS_ENABLED=false` keeps Stripe and Razorpay checkout
off.

Seven days before a paid period ends, the workspace's billing managers get an in-app reminder to request and pay
the renewal invoice. When a paid period ends without a renewal, the workspace is past due and keeps paid features for
`BILLING_GRACE_DAYS`, then falls back to Free allowances until a renewal is paid. Nothing is deleted.
