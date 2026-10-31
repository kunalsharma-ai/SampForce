-- Invoice-paid plans: billing managers are reminded once per period, a week before it ends.
ALTER TABLE "subscriptions" ADD COLUMN "renewal_reminded_at" TIMESTAMPTZ(3);
