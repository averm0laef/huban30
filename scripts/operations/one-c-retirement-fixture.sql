-- Isolated scratch database only. Schema comes from production WITHOUT DATA.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() !~ '^an30_cleanup_scratch_' THEN
    RAISE EXCEPTION 'This fixture is forbidden outside an isolated scratch database';
  END IF;
END $$;
INSERT INTO app.integration_endpoints(integration_key,is_enabled)
  VALUES ('one_c',true),('one_c_secondary',false);
INSERT INTO app.products(id,external_id,sku,name,slug,one_c_source,created_at,source_version)
VALUES
  ('10000000-0000-4000-8000-000000000001','00-00001','BP-001','Колодки тест','kolodki-test-0123456789','one_c','2026-11-23T20:44:00Z',1),
  ('10000000-0000-4000-8000-000000000002','live-product','LIVE-1','Свежий товар','retirement-live','one_c',now(),1),
  ('10000000-0000-4000-8000-000000000003','secondary-product','SECOND-1','Другая база','retirement-secondary','one_c_secondary',now(),1);
INSERT INTO app.warehouses(id,code,name)
  VALUES ('20000000-0000-4000-8000-000000000001','RETIRE-TEST','Тестовый склад');
INSERT INTO app.inventory_balances(product_id,warehouse_id,quantity_on_hand,source_version,updated_at)
SELECT id,'20000000-0000-4000-8000-000000000001',7,1,'2026-11-23T20:47:00Z'
  FROM app.products;
INSERT INTO app.product_prices(product_id,amount_kopeks,valid_from,created_at)
SELECT id,10000,'2026-11-23T20:47:00Z','2026-11-23T20:47:00Z' FROM app.products;
INSERT INTO app.product_catalogue_cards(product_id,product_sku,catalogue_brand,
  catalogue_article,catalogue_article_id,photos)
VALUES ('10000000-0000-4000-8000-000000000001','BP-001','TEST','BP-001',1,ARRAY['https://example.test/photo.jpg']);
INSERT INTO app.one_c_exchange_runs(kind,filename,content_checksum,contains_only_changes,
  exported_at,batch_size,header_rows,body_rows,phase,status,source_key,created_at,updated_at)
VALUES
 ('catalog','initial-catalog.xml',decode(repeat('11',32),'hex'),false,
  '2026-11-23T20:43:00Z',500,'[]',
  '[{"entityType":"product","externalId":"00-00001"}]','done','completed','one_c',
  '2026-11-23T20:43:00Z','2026-11-23T20:46:00Z'),
 ('offers','initial-offers.xml',decode(repeat('22',32),'hex'),false,
  '2026-11-23T20:46:00Z',500,'[]','[]','done','completed','one_c',
  '2026-11-23T20:46:00Z','2026-11-23T20:48:00Z');
GRANT USAGE ON SCHEMA app TO an30_app;
GRANT ALL ON ALL TABLES IN SCHEMA app TO an30_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA app TO an30_app;
