-- Live payments by the Money Moves app: the code a scan takes it on by, and the username it was sent to.
ALTER TABLE "payments" ADD COLUMN "app_code" TEXT, ADD COLUMN "app_sent_to" TEXT;
