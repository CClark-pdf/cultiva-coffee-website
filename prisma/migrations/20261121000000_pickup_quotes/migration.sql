-- Pickup scheduling is based on Philippine calendar dates and half-hour slots.
ALTER TABLE "Order" ADD COLUMN "pickupDate" TEXT, ADD COLUMN "pickupTime" TEXT;
CREATE INDEX "Order_pickupDate_pickupTime_status_idx" ON "Order"("pickupDate","pickupTime","status");
CREATE TABLE "PickupSchedule" (
  "weekday" INTEGER NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "opensAt" TEXT NOT NULL DEFAULT '08:00',
  "closesAt" TEXT NOT NULL DEFAULT '18:00',
  "capacity" INTEGER NOT NULL DEFAULT 5,
  CONSTRAINT "PickupSchedule_valid" CHECK ("weekday" BETWEEN 0 AND 6 AND "capacity" BETWEEN 1 AND 50)
);
INSERT INTO "PickupSchedule" ("weekday") SELECT generate_series(0,6);
ALTER TABLE "Package" ADD COLUMN "transportFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "packagePrice" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transportFee" INTEGER NOT NULL DEFAULT 0;
UPDATE "Booking" SET "packagePrice"="total";
ALTER TABLE "Package" ADD CONSTRAINT "Package_transportFee_valid" CHECK ("transportFee" >= 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_quote_valid" CHECK ("packagePrice" >= 0 AND "transportFee" >= 0 AND "total" = "packagePrice" + "transportFee") NOT VALID;
