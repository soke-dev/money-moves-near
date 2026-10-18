-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('USER', 'BOT', 'ADMIN');

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ChatStatus" NOT NULL DEFAULT 'OPEN',
    "needs_human" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "text" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_conversations_user_id_idx" ON "chat_conversations"("user_id");

-- CreateIndex
CREATE INDEX "chat_conversations_status_idx" ON "chat_conversations"("status");

-- CreateIndex
CREATE INDEX "chat_conversations_needs_human_status_idx" ON "chat_conversations"("needs_human", "status");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
