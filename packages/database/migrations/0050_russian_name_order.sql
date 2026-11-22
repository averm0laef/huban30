-- «По названию» in the Russian alphabet whatever the server's C library.
-- The production database runs on musl (the Alpine image of PostgreSQL),
-- where the libc collation en_US.utf8 is plain byte order: «Bcd» came
-- before «abc» and every «ё» after «я». ICU orders as a Russian reader
-- does: case aside, «ё» read as «е» (as in a dictionary), Cyrillic before
-- Latin. Created here, so a server without ICU fails at the deploy, not on
-- the catalogue.

CREATE COLLATION IF NOT EXISTS app.russian_names (provider = icu, locale = 'ru-RU');
