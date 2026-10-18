-- Businesses are deactivated, never deleted - and nothing they did is ever lost:
-- their money, their KYC records and the audit trail stay for good. Enforced by
-- the database itself, so it holds against any query, not only the app's.

-- 1. A business can't be removed from under its records.
ALTER TABLE "members" DROP CONSTRAINT "members_business_id_fkey";
ALTER TABLE "members" ADD CONSTRAINT "members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_business_id_fkey";
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_links" DROP CONSTRAINT "payment_links_business_id_fkey";
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" DROP CONSTRAINT "payments_business_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_business_id_fkey";
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements" DROP CONSTRAINT "settlements_payment_id_fkey";
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_events" DROP CONSTRAINT "settlement_events_settlement_id_fkey";
ALTER TABLE "settlement_events" ADD CONSTRAINT "settlement_events_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" DROP CONSTRAINT "applications_business_id_fkey";
ALTER TABLE "applications" ADD CONSTRAINT "applications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" DROP CONSTRAINT "documents_business_id_fkey";
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "identity_checks" DROP CONSTRAINT "identity_checks_business_id_fkey";
ALTER TABLE "identity_checks" ADD CONSTRAINT "identity_checks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. These rows are never deleted, one at a time or all at once.
CREATE OR REPLACE FUNCTION mmb_keep_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in "%" are kept for good: deactivate, never delete.', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER keep_rows BEFORE DELETE ON "businesses" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "businesses" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "bank_accounts" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "bank_accounts" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "payment_links" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "payment_links" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "payments" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "settlements" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "settlements" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "settlement_events" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "settlement_events" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "applications" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "applications" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "documents" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "documents" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "identity_checks" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "identity_checks" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_rows BEFORE DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION mmb_keep_rows();
CREATE TRIGGER keep_all_rows BEFORE TRUNCATE ON "audit_log" FOR EACH STATEMENT EXECUTE FUNCTION mmb_keep_rows();

-- 3. A stored document never changes: a newer file is a new row, and the old one stays.
CREATE OR REPLACE FUNCTION mmb_document_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data IS DISTINCT FROM OLD.data OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size IS DISTINCT FROM OLD.size
     OR NEW.mime IS DISTINCT FROM OLD.mime OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A stored document never changes - a newer file is uploaded as a new one.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER document_fixed BEFORE UPDATE ON "documents" FOR EACH ROW EXECUTE FUNCTION mmb_document_fixed();

-- 4. The audit log and payout timelines are written once and never edited.
CREATE OR REPLACE FUNCTION mmb_written_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in "%" are written once and never edited.', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER written_once BEFORE UPDATE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION mmb_written_once();
CREATE TRIGGER written_once BEFORE UPDATE ON "settlement_events" FOR EACH ROW EXECUTE FUNCTION mmb_written_once();
