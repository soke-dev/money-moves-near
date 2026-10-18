-- A link or an outlet can ask for the email only.
ALTER TABLE "payment_links" ADD COLUMN "ask_name" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "outlets" ADD COLUMN "ask_name" BOOLEAN NOT NULL DEFAULT true;
