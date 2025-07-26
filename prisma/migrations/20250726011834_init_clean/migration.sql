-- CreateEnum
CREATE TYPE "InstanceState" AS ENUM ('notAuthorized', 'qr_code', 'authorized', 'yellowCard', 'blocked', 'starting');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" BIGSERIAL NOT NULL,
    "idInstance" TEXT NOT NULL,
    "instanceGuid" TEXT,
    "name" TEXT,
    "apiTokenInstance" TEXT NOT NULL,
    "stateInstance" "InstanceState",
    "userId" TEXT NOT NULL,
    "settings" JSON DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instance_idInstance_key" ON "Instance"("idInstance");

-- CreateIndex
CREATE UNIQUE INDEX "Instance_instanceGuid_key" ON "Instance"("instanceGuid");

-- CreateIndex
CREATE INDEX "Instance_userId_idx" ON "Instance"("userId");

-- AddForeignKey
ALTER TABLE "Instance" ADD CONSTRAINT "Instance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
