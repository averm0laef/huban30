-- Справочник легковых автомобилей UMAPI: марка -> модель (поколение) -> модификация.
--
-- Файл cb_passenger_cars.csv куплен владельцем у UMAPI вместе с правом
-- хранить справочник в своей базе (docs/UMAPI.md). Его загружает команда
-- packages/database/dist/import-vehicle-catalog.js; сайт только читает.
-- Выбор машины на /podbor, в «Моём авто» и в гараже идёт отсюда и не тратит
-- запросов платных каталогов: API UMAPI остаётся для кроссов и применимости.
--
-- Номера записей начинаются со 100 000 001: так они не пересекаются с
-- номерами прежнего справочника app.parts_finder_vehicle_* (FAPI). По номеру
-- машины, сохранённой в браузере или в гараже до перехода, API понимает, из
-- какого справочника она выбрана, и прежний выбор продолжает работать.
--
-- Номера UMAPI (umapi_id) - ключ обновления: тот же файл, загруженный снова,
-- ничего не меняет; запись, пропавшая из нового файла, снимается с показа
-- (is_active = false), но не удаляется - на неё могут ссылаться гаражи.

CREATE TABLE app.vehicle_catalog_makes (
  id integer GENERATED ALWAYS AS IDENTITY (START WITH 100000001) PRIMARY KEY,
  umapi_id integer NOT NULL UNIQUE CHECK (umapi_id > 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.vehicle_catalog_models (
  id integer GENERATED ALWAYS AS IDENTITY (START WITH 100000001) PRIMARY KEY,
  make_id integer NOT NULL REFERENCES app.vehicle_catalog_makes (id) ON DELETE RESTRICT,
  umapi_id integer NOT NULL UNIQUE CHECK (umapi_id > 0),
  -- «COROLLA седан (_E12_)»: поколение с кодом кузова, как в каталоге.
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- «COROLLA», «LAND CRUISER PRADO»: модель, как её называют.
  short_name text CHECK (short_name IS NULL OR char_length(short_name) <= 80),
  -- «III», «FX»: серия внутри модели.
  series text CHECK (series IS NULL OR char_length(series) <= 40),
  -- PC — легковой, LCV — лёгкий коммерческий, E-PC / E-LCV — электро.
  vehicle_types text[] NOT NULL DEFAULT '{}',
  produced_from date,
  produced_to date CHECK (produced_to IS NULL OR produced_from IS NULL OR produced_to >= produced_from),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX vehicle_catalog_models_make_idx ON app.vehicle_catalog_models (make_id);

CREATE TABLE app.vehicle_catalog_modifications (
  id integer GENERATED ALWAYS AS IDENTITY (START WITH 100000001) PRIMARY KEY,
  model_id integer NOT NULL REFERENCES app.vehicle_catalog_models (id) ON DELETE RESTRICT,
  umapi_id integer NOT NULL UNIQUE CHECK (umapi_id > 0),
  -- «1.4 (L08, L68)», «2.0 TCe (DZ1N)», «530 d xDrive»: объём, исполнение, коды двигателя.
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  produced_from date,
  produced_to date CHECK (produced_to IS NULL OR produced_from IS NULL OR produced_to >= produced_from),
  power_kw numeric(7, 1) CHECK (power_kw IS NULL OR power_kw >= 0),
  power_ps integer CHECK (power_ps IS NULL OR power_ps >= 0),
  capacity_cc integer CHECK (capacity_cc IS NULL OR capacity_cc >= 0),
  capacity_l numeric(4, 1) CHECK (capacity_l IS NULL OR capacity_l >= 0),
  cylinders smallint CHECK (cylinders IS NULL OR cylinders >= 0),
  valves smallint CHECK (valves IS NULL OR valves >= 0),
  doors smallint CHECK (doors IS NULL OR doors >= 0),
  engine_type text CHECK (engine_type IS NULL OR char_length(engine_type) <= 80),
  body_type text CHECK (body_type IS NULL OR char_length(body_type) <= 80),
  drive_type text CHECK (drive_type IS NULL OR char_length(drive_type) <= 80),
  gear_type text CHECK (gear_type IS NULL OR char_length(gear_type) <= 80),
  fuel_type text CHECK (fuel_type IS NULL OR char_length(fuel_type) <= 80),
  fuel_mixture text CHECK (fuel_mixture IS NULL OR char_length(fuel_mixture) <= 120),
  catalyst text CHECK (catalyst IS NULL OR char_length(catalyst) <= 120),
  brake_system text CHECK (brake_system IS NULL OR char_length(brake_system) <= 80),
  brake_type text CHECK (brake_type IS NULL OR char_length(brake_type) <= 80),
  voltage text CHECK (voltage IS NULL OR char_length(voltage) <= 40),
  has_abs boolean,
  has_asr boolean,
  country_id integer CHECK (country_id IS NULL OR country_id >= 0),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX vehicle_catalog_modifications_model_idx ON app.vehicle_catalog_modifications (model_id);

-- Журнал загрузок справочника: какой файл, когда и что изменилось.
CREATE TABLE app.vehicle_catalog_imports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (source = 'umapi'),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows_total integer NOT NULL CHECK (rows_total >= 0),
  rows_rejected integer NOT NULL CHECK (rows_rejected >= 0),
  -- {"makes": {"added": 736, "changed": 0, "retired": 0}, "models": {...}, "modifications": {...}}
  changes jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX vehicle_catalog_imports_finished_idx ON app.vehicle_catalog_imports (finished_at DESC);
