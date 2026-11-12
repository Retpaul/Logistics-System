-- Auth (refresh tokens), tenant branding/currency and order package size.
-- Generated with prisma migrate diff; CHECK constraints appended by hand (Prisma cannot express them).

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "notes" VARCHAR(1000),
ADD COLUMN     "packageSize" "PackageSize" NOT NULL DEFAULT 'MEDIUM';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
ADD COLUMN     "secondaryColor" VARCHAR(7),
ADD COLUMN     "tagline" VARCHAR(200);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_tenantId_userId_idx" ON "RefreshToken"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data rules enforced in the database as well as in the API.
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase" CHECK ("email" = lower("email"));
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_brandColor_format" CHECK ("brandColor" IS NULL OR "brandColor" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_secondaryColor_format" CHECK ("secondaryColor" IS NULL OR "secondaryColor" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_subdomain_format" CHECK ("subdomain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$');
