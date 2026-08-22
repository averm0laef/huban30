-- Foreign-key maintenance for staff-confirmed article cross references.
-- PostgreSQL does not create an index for the referencing side automatically;
-- without it, deleting a confirming user would scan the full cross table.

CREATE INDEX article_crosses_confirmed_by_idx
  ON app.article_crosses (confirmed_by)
  WHERE confirmed_by IS NOT NULL;

