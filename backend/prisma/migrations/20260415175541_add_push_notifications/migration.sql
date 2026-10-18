/*
  Warnings:

  - You are about to drop the column `price_alerts` on the `notification_prefs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "notification_prefs" DROP COLUMN "price_alerts",
ADD COLUMN     "app_updates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expo_push_token" TEXT,
ADD COLUMN     "savings_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "security_alerts" BOOLEAN NOT NULL DEFAULT true;
