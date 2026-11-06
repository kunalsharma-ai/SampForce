-- Rebrand: the product is now SampForce (ADR 0055). The launch plans were seeded as "DealFlow <tier>"; rename the
-- ones that still carry the old product name. A name an operator already changed to something else is left alone.
UPDATE "plans"
SET name = 'SampForce' || substr(name, length('DealFlow') + 1), updated_at = now()
WHERE name LIKE 'DealFlow %';
