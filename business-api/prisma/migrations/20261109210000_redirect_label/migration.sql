-- The words on a checkout's return button.
ALTER TABLE "payment_links" ADD COLUMN "redirect_label" TEXT;
