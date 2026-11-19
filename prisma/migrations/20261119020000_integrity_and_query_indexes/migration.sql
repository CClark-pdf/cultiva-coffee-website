-- Backstop the one-cart calendar and one pending request per customer/date.
-- Historical rows are checked before index creation so a conflict gets a useful error.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Booking" WHERE "status" IN ('CONFIRMED','PREPARING','READY','ONGOING','COMPLETED') GROUP BY "eventDate" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Resolve duplicate reserved coffee cart dates before migrating';
  END IF;
  IF EXISTS (SELECT 1 FROM "Booking" WHERE "status" = 'PENDING' GROUP BY "userId", "eventDate" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Resolve duplicate pending requests per customer and date before migrating';
  END IF;
END $$;
CREATE UNIQUE INDEX "Booking_one_reserved_cart_per_day" ON "Booking"("eventDate") WHERE "status" IN ('CONFIRMED','PREPARING','READY','ONGOING','COMPLETED');
CREATE UNIQUE INDEX "Booking_one_pending_per_customer_day" ON "Booking"("userId", "eventDate") WHERE "status" = 'PENDING';

-- Preserve valid historical records while enforcing these rules for new writes.
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_valid" CHECK ("total" >= 0 AND "paid" >= 0 AND "paid" <= "total") NOT VALID;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amounts_valid" CHECK ("total" >= 0 AND "paid" >= 0 AND "paid" <= "total" AND "guests" > 0) NOT VALID;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_counts_valid" CHECK ("quantity" >= 0 AND "damaged" >= 0 AND "lost" >= 0 AND "damaged" + "lost" <= "quantity") NOT VALID;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_counts_valid" CHECK ("quantity" > 0 AND "damaged" >= 0 AND "lost" >= 0 AND "damaged" + "lost" <= "quantity") NOT VALID;
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_valid" CHECK ("price" >= 0) NOT VALID;
ALTER TABLE "Package" ADD CONSTRAINT "Package_values_valid" CHECK ("price" >= 0 AND "servings" > 0 AND "hours" > 0) NOT VALID;

CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX "Booking_userId_eventDate_idx" ON "Booking"("userId", "eventDate");
CREATE INDEX "Booking_status_eventDate_idx" ON "Booking"("status", "eventDate");
