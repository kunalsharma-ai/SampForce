# Recording offline payments

Workspaces pay by bank transfer against a DealFlow invoice (ADR 0013). An operator with the **ADMIN** role records
each payment.

1. Sign in to the operator console (`/operator`). **Waiting for payment** lists every open invoice with its
   workspace, number, plan, seats and amount.
2. Match the bank credit to the invoice by the number the payer quoted (`DF-…`) and check the **full amount** has
   arrived. For a partial or wrong amount, do not mark it paid: contact the workspace, and void the invoice if a
   different one is needed (the workspace can then request a new one).
3. Open the workspace, enter the bank or transfer reference (UTR, SWIFT reference) and the day the money arrived,
   and choose **Mark paid**. The plan starts (or renews from the end of the current period), the workspace's billing
   managers are notified, and the action is written to both audit logs.
4. Issue any tax invoice Sampledge's accounting requires outside DealFlow.

Settings: `OFFLINE_PAYMENT_INSTRUCTIONS` holds the bank details shown on every open invoice (use `\n` for line
breaks). `ONLINE_PAYMENTS_ENABLED=false` keeps Stripe and Razorpay checkout off.

When a paid period ends without a renewal, the workspace is past due and keeps paid features for
`BILLING_GRACE_DAYS`, then falls back to Free allowances until a renewal is paid. Nothing is deleted.
