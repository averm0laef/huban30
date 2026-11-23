-- The former make -> model -> modification list of the picker, filled on
-- demand from FAPI (0038_parts_finder.sql), is replaced by the UMAPI
-- passenger-car catalog (0056_vehicle_catalog.sql, docs/UMAPI.md).
--
-- What these tables held was a copy of FAPI lists (re-obtainable) plus the
-- shop's hand-made list of makes and models, which lives on in code
-- (apps/api/src/parts-finder/engine/vehicle-seed.ts). Nothing else refers to
-- them; the VIN cache app.parts_finder_vehicle_cache stays.
--
-- A garage car picked from the former list kept its title and details; its
-- dead list numbers are cleared so the site never sends them anywhere.

UPDATE app.customer_vehicles
SET catalog_model_id = NULL, catalog_modification_id = NULL, updated_at = clock_timestamp()
WHERE catalog_model_id < 100000001 OR catalog_modification_id < 100000001;

DROP TABLE app.parts_finder_vehicle_modifications;
DROP TABLE app.parts_finder_vehicle_models;
DROP TABLE app.parts_finder_vehicle_makes;
