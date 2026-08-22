-- Migration 0021 introduced the anonymized state with an empty customer name,
-- but the original trim constraint from 0015 still required that value to be
-- non-empty. Keep whitespace normalization here; the state constraint added in
-- 0021 remains responsible for requiring a name before anonymization and an
-- empty value afterwards.

ALTER TABLE app.supplier_waitlist_requests
  DROP CONSTRAINT supplier_waitlist_requests_customer_name_trimmed,
  ADD CONSTRAINT supplier_waitlist_requests_customer_name_trimmed CHECK (
    customer_name=btrim(customer_name)
  );

