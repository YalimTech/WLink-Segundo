-- CreateEnum
CREATE TYPE "InstanceState" AS ENUM ('notAuthorized', 'qr_code', 'authorized', 'yellowCard', 'blocked', 'starting');

-- CreateTable
CREATE TABLE "users" (
    "locationId" TEXT NOT NULL,
    "companyId" TEXT,
    "ghlUserId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("locationId")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" BIGSERIAL NOT NULL,
    "instanceName" TEXT NOT NULL,
    "instanceId" TEXT,
    "name" TEXT,
    "apiTokenInstance" TEXT NOT NULL,
    "stateInstance" "InstanceState",
    "locationId" TEXT NOT NULL,
    "settings" JSON DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_locationId_key" ON "users"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "instances_instanceName_key" ON "instances"("instanceName");

-- CreateIndex
CREATE UNIQUE INDEX "instances_instanceId_key" ON "instances"("instanceId");

-- CreateIndex
CREATE INDEX "instances_locationId_idx" ON "instances"("locationId");

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "users"("locationId") ON DELETE CASCADE ON UPDATE CASCADE;
