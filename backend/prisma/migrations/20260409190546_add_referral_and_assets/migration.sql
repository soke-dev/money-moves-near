/*
  Warnings:

  - A unique constraint covering the columns `[referral_code]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `referral_code` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Asset" ADD VALUE 'ETH';
ALTER TYPE "Asset" ADD VALUE 'MOVE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referral_code" TEXT NOT NULL,
ADD COLUMN     "referred_by" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");
