-- Support can edit and delete what it sent, and the person reading it has to
-- find out. The poll cursor moves from created_at to updated_at so a change to
-- an old message is something the client can still be handed.

ALTER TABLE "chat_messages" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill to created_at rather than leaving the default.
--
-- Every existing row would otherwise carry this moment as its updated_at, and
-- the first client to poll with a cursor older than the deploy would be handed
-- the entire history of its conversation as though all of it had just changed.
UPDATE "chat_messages" SET "updated_at" = "created_at";

CREATE INDEX "chat_messages_conversation_id_updated_at_idx"
  ON "chat_messages"("conversation_id", "updated_at");
