-- Edit distance for the catalogue search. A typo used to be recognised by
-- shared trigrams alone, and long words share their endings: «глушитель»
-- found «очиститель» and «предохранитель», «генератор» found «амортизатор».
-- The search now also asks that a word of the product is a letter or two
-- away from the typed one (levenshtein_less_equal, see catalog-search-sql.ts).

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
