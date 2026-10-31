-- Offline payment (bank transfer against a DealFlow invoice). A separate migration because a new enum value
-- cannot be used in the transaction that adds it.
ALTER TYPE "BillingProvider" ADD VALUE 'OFFLINE';
