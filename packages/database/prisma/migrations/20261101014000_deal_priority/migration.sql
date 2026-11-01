-- Deal priority, set by people on the board and in the deal panel (design spec Part 5). Covered by the existing
-- tenant isolation policy on opportunities.
CREATE TYPE "DealPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
ALTER TABLE "opportunities" ADD COLUMN "priority" "DealPriority";
