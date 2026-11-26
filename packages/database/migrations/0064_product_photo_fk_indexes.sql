CREATE INDEX image_rights_sources_created_by_idx ON app.image_rights_sources (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX product_images_uploaded_by_idx ON app.product_images (uploaded_by) WHERE uploaded_by IS NOT NULL;
CREATE INDEX product_image_withdrawals_product_id_idx ON app.product_image_withdrawals (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX product_image_withdrawals_rights_source_idx ON app.product_image_withdrawals (rights_source_id) WHERE rights_source_id IS NOT NULL;
CREATE INDEX product_image_withdrawals_withdrawn_by_idx ON app.product_image_withdrawals (withdrawn_by) WHERE withdrawn_by IS NOT NULL;
