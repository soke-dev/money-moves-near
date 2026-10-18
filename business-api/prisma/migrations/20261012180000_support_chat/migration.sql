-- CreateEnum
CREATE TYPE "SupportFrom" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "support_threads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_id" TEXT,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_read_at" TIMESTAMP(3),
    "team_read_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "from" "SupportFrom" NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT,
    "file" BYTEA,
    "file_name" TEXT,
    "file_mime" TEXT,
    "file_size" INTEGER,
    "page" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_threads_user_id_business_id_idx" ON "support_threads"("user_id", "business_id");

-- CreateIndex
CREATE INDEX "support_threads_status_last_at_idx" ON "support_threads"("status", "last_at");

-- CreateIndex
CREATE INDEX "support_messages_thread_id_created_at_idx" ON "support_messages"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Like every record a business has: never deleted.
CREATE TRIGGER keep_rows BEFORE DELETE ON "support_threads" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "support_threads" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "support_messages" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "support_messages" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
