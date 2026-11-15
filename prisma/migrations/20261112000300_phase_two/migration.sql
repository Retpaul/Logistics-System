-- PostgreSQL DDL is transactional: a conflicting active assignment must roll back all changes.
BEGIN;
ALTER TABLE "Rider"
 ADD COLUMN "onboardingStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 ADD COLUMN "phone" VARCHAR(25),
 ADD COLUMN "invitationHash" CHAR(64),
 ADD COLUMN "invitationExpiresAt" TIMESTAMPTZ(3),
 ADD COLUMN "latitude" DECIMAL(9,6),
 ADD COLUMN "longitude" DECIMAL(9,6),
 ADD COLUMN "locationAt" TIMESTAMPTZ(3),
 ADD COLUMN "bikeSerial" VARCHAR(100),
 ADD CONSTRAINT "Rider_onboarding_status" CHECK ("onboardingStatus" IN ('INVITED','PENDING','APPROVED','REJECTED')),
 ADD CONSTRAINT "Rider_location_range" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);
CREATE UNIQUE INDEX "Rider_invitationHash_key" ON "Rider"("invitationHash");
-- Existing riders require explicit approval before going available.
UPDATE "Rider" SET available=false;
ALTER TABLE "Order" ADD COLUMN "pickedUpAt" TIMESTAMPTZ(3), ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
 ADD COLUMN "proofFileId" UUID, ADD COLUMN "proofRecipient" VARCHAR(150);
UPDATE "Order" o SET "pickedUpAt"=e.pickup,"deliveredAt"=e.delivery
FROM (SELECT "orderId", min("createdAt") FILTER (WHERE status='PICKED_UP') pickup,
 min("createdAt") FILTER (WHERE status='DELIVERED') delivery FROM "OrderEvent" GROUP BY "orderId") e WHERE o.id=e."orderId";
-- Fail visibly on inconsistent existing assignments rather than silently unassigning work.
CREATE UNIQUE INDEX "Order_one_active_per_rider" ON "Order"("riderId")
 WHERE "riderId" IS NOT NULL AND status IN ('ASSIGNED','PICKED_UP','IN_TRANSIT');
CREATE TABLE "StoredFile" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "userId" UUID NOT NULL,
 key TEXT NOT NULL UNIQUE, filename VARCHAR(120) NOT NULL, "contentType" VARCHAR(127) NOT NULL,
 size INTEGER NOT NULL CHECK (size>0), purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('LICENSE','INSURANCE','PROOF')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("tenantId","userId") REFERENCES "User"("tenantId",id) ON DELETE RESTRICT
);
CREATE INDEX "StoredFile_tenantId_userId_purpose_idx" ON "StoredFile"("tenantId","userId",purpose);
COMMIT;
