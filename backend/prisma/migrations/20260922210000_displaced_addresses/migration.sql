-- Where an address went when it was swapped. Previously only a console.warn,
-- which is the only pointer to money sent to the old one.
ALTER TABLE "users" ADD COLUMN "displaced_addresses" JSONB NOT NULL DEFAULT '[]';
