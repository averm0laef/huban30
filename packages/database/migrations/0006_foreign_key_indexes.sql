CREATE INDEX staff_members_invited_by_idx ON app.staff_members (invited_by);
CREATE INDEX staff_invitations_invited_by_idx ON app.staff_invitations (invited_by);
CREATE INDEX auth_sessions_rotated_from_idx ON app.auth_sessions (rotated_from_id)
  WHERE rotated_from_id IS NOT NULL;
CREATE INDEX catalog_import_batches_uploaded_object_idx
  ON app.catalog_import_batches (uploaded_object_id)
  WHERE uploaded_object_id IS NOT NULL;
CREATE INDEX catalog_import_conflicts_import_row_idx
  ON app.catalog_import_conflicts (import_row_id)
  WHERE import_row_id IS NOT NULL;
CREATE INDEX catalog_import_conflicts_resolved_by_idx
  ON app.catalog_import_conflicts (resolved_by)
  WHERE resolved_by IS NOT NULL;
CREATE INDEX catalog_revisions_applied_by_idx ON app.catalog_revisions (applied_by)
  WHERE applied_by IS NOT NULL;
CREATE INDEX catalog_revisions_rolled_back_by_idx ON app.catalog_revisions (rolled_back_by)
  WHERE rolled_back_by IS NOT NULL;
CREATE INDEX product_prices_import_batch_idx ON app.product_prices (import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX inventory_events_actor_user_idx ON app.inventory_events (actor_user_id)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX inventory_events_import_batch_idx ON app.inventory_events (import_batch_id)
  WHERE import_batch_id IS NOT NULL;
CREATE INDEX order_status_history_actor_user_idx ON app.order_status_history (actor_user_id)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX payment_webhook_events_payment_idx ON app.payment_webhook_events (payment_id)
  WHERE payment_id IS NOT NULL;
CREATE INDEX refunds_requested_by_idx ON app.refunds (requested_by)
  WHERE requested_by IS NOT NULL;
CREATE INDEX chat_threads_assigned_staff_idx ON app.chat_threads (assigned_staff_id)
  WHERE assigned_staff_id IS NOT NULL;
CREATE INDEX chat_threads_order_idx ON app.chat_threads (order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX chat_messages_reply_to_idx ON app.chat_messages (reply_to_id)
  WHERE reply_to_id IS NOT NULL;
CREATE INDEX chat_messages_sender_user_idx ON app.chat_messages (sender_user_id)
  WHERE sender_user_id IS NOT NULL;
CREATE INDEX content_pages_created_by_idx ON app.content_pages (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX content_pages_updated_by_idx ON app.content_pages (updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX banners_image_object_idx ON app.banners (image_object_id)
  WHERE image_object_id IS NOT NULL;
CREATE INDEX site_settings_updated_by_idx ON app.site_settings (updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX attendance_events_recorded_by_idx ON app.attendance_events (recorded_by)
  WHERE recorded_by IS NOT NULL;
CREATE INDEX invoices_created_by_idx ON app.invoices (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX invoices_document_object_idx ON app.invoices (document_object_id)
  WHERE document_object_id IS NOT NULL;
CREATE INDEX report_runs_result_object_idx ON app.report_runs (result_object_id)
  WHERE result_object_id IS NOT NULL;
