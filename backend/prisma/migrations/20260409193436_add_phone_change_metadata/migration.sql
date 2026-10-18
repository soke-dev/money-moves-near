-- AlterEnum
ALTER TYPE "VerificationType" ADD VALUE 'PHONE_CHANGE';

-- AlterTable
ALTER TABLE "verification_codes" ADD COLUMN     "metadata" TEXT;
