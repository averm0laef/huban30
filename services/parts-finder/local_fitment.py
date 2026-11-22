"""Import and search fitment rows supplied by the shop or a licensed source."""

import argparse
import csv
import hashlib
import os
import sqlite3
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from part_query import ALIASES, words
from runtime_config import env_file, state_file

FIELDS = (
    "make", "model", "category", "configuration", "engine", "liters", "year_from", "year_to",
    "article", "brand", "oem", "source",
)
SCHEMA = """
CREATE TABLE IF NOT EXISTS fitment (
    make TEXT, model TEXT, category TEXT, configuration TEXT, engine TEXT, liters REAL,
    year_from INTEGER, year_to INTEGER, article TEXT, brand TEXT, oem INTEGER, source TEXT,
    make_key TEXT, model_key TEXT
);
CREATE INDEX IF NOT EXISTS fitment_lookup ON fitment(category, make_key, model_key);
"""


def db_path():
    return Path(os.getenv("AN30_FITMENT_DB") or state_file("an30-fitment.sqlite3"))


def lookup_key(value):
    return " ".join(ALIASES.get(token, token) for token in words(value))


def import_fitment(csv_path, database, categories):
    with Path(csv_path).open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != list(FIELDS):
            raise ValueError("Нужны столбцы в таком порядке: " + ",".join(FIELDS))
        with closing(sqlite3.connect(database)) as db, db:
            db.executescript(SCHEMA)
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM fitment")
            count = 0
            for index, raw in enumerate(reader, 2):
                try:
                    data = {name: raw[name].strip() for name in FIELDS}
                    if not all(data[name] for name in (
                        "make", "model", "category", "configuration", "article", "brand", "source",
                    )) or len(data["article"]) > 64 or data["category"] not in categories:
                        raise ValueError
                    start = int(data["year_from"]) if data["year_from"] else None
                    end = int(data["year_to"]) if data["year_to"] else None
                    liters = float(data["liters"]) if data["liters"] else None
                    if data["oem"] not in ("0", "1") or (start and end and start > end) or (
                        liters is not None and not 0 < liters < 30
                    ):
                        raise ValueError
                except (ValueError, TypeError, AttributeError):
                    raise ValueError(f"Проверьте формат и обязательные поля в строке {index}.") from None
                db.execute("INSERT INTO fitment VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
                    data["make"], data["model"], data["category"], data["configuration"],
                    data["engine"].upper(), liters, start, end, data["article"], data["brand"],
                    int(data["oem"]), data["source"], lookup_key(data["make"]), lookup_key(data["model"]),
                ))
                count += 1
            if not count:
                raise ValueError("В CSV нет данных для импорта.")
    return count


def local_fitments(tokens, category, year, engine, liters):
    path = db_path()
    if not path.is_file():
        return {}
    keys = sorted({" ".join(tokens[i:i + size]) for i in range(len(tokens)) for size in range(1, 5)})
    places = ",".join("?" for _ in keys)
    vehicle_parts = defaultdict(dict)
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)) as db:
        for make, model, _, variant, code, capacity, start, end, article, brand, oem, source in db.execute(
            "SELECT make, model, category, configuration, engine, liters, year_from, year_to, article, brand, oem, source "
            f"FROM fitment WHERE category=? AND make_key IN ({places}) AND model_key IN ({places}) "
            "ORDER BY make, model, configuration, article", (category, *keys, *keys),
        ):
            if year and ((start and year < start) or (end and year > end)):
                continue
            if (engine and code != engine) or (liters and (capacity is None or round(capacity, 1) != liters)):
                continue
            vehicle_parts[(make, model, variant, code, capacity, start, end)][(brand, article)] = {
                "article": article, "brand": brand, "description": variant, "oem": bool(oem), "source": source,
            }
    variants = {}
    for fields, parts in vehicle_parts.items():
        make, model, variant, code, capacity, start, end = fields
        ident = int(hashlib.sha256(repr(fields).encode()).hexdigest()[:12], 16)
        years = f"{start}–{end}" if start and end else f"с {start}" if start else f"до {end}" if end else None
        label = " · ".join(filter(None, (variant, f"{capacity:g} л" if capacity else None, code, years)))
        variants[ident] = {"id": ident, "vehicle": f"{make} {model}", "label": label, "parts": list(parts.values())}
    return variants


if __name__ == "__main__":
    from dotenv import load_dotenv
    from vehicle_parts import CATEGORIES

    load_dotenv(env_file())
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="выгрузка магазина в формате UTF-8 CSV")
    parser.add_argument("--db", type=Path, default=db_path(), help="куда импортировать")
    args = parser.parse_args()
    try:
        count = import_fitment(args.csv_path, args.db, {name for name, _ in CATEGORIES})
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"{error}\n")
    print(f"Загружено строк применимости: {count}")
