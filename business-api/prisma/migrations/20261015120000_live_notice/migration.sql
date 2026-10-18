-- Who has closed the "you're approved" notice.
ALTER TABLE "members" ADD COLUMN "live_notice_closed_at" TIMESTAMP(3);
