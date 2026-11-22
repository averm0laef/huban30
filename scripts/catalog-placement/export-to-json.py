"""Converts the 1С list export into the JSON the scripts of this folder read.

The export is made in 1С by reading only: «Номенклатура» → «Ещё» → «Вывести список» → save as .xlsx. This script
reads that file; 1С itself is never touched.

Usage: python3 scripts/catalog-placement/export-to-json.py <export.xlsx> [output.json] [--price-column "Оптовая цена"]
Needs openpyxl (the only dependency; it is not part of the project's packages)."""
import argparse
import json
import pathlib
import sys

import openpyxl

parser = argparse.ArgumentParser(description="Converts the 1С list export (.xlsx) into the JSON the catalog-placement scripts read.")
parser.add_argument("source", help="the export saved from 1С, .xlsx")
parser.add_argument("target", nargs="?", help="where to write the JSON; by default next to the export")
parser.add_argument("--price-column", default="Оптовая цена", help="the header of the price column in the export")
options = parser.parse_args()
source = pathlib.Path(options.source)
target = pathlib.Path(options.target) if options.target else source.with_suffix(".json")
price_column = options.price_column

COLUMNS = {"Наименование": "name", "Остаток": "stock", "Ед. изм": "unit", price_column: "price", "Артикул": "sku", "Код": "code", "Описание": "note"}


def text(value):
    return "" if value is None else str(value).strip()


sheet = openpyxl.load_workbook(source, read_only=True).worksheets[0]
rows = sheet.iter_rows(values_only=True)
header = [text(cell) for cell in next(rows)]
missing = [title for title in COLUMNS if title not in header]
if missing:
    sys.exit(f"The export has no column(s) {missing}. Columns found: {header}")
index = {key: header.index(title) for title, key in COLUMNS.items()}
items = []
for row in rows:
    item = {key: text(row[position]) if position < len(row) else "" for key, position in index.items()}
    if item["name"]:
        items.append(item)
target.write_text(json.dumps(items, ensure_ascii=False, indent=0), encoding="utf8")
print(f"items: {len(items)} | with an article: {sum(1 for item in items if item['sku'])} | with a price: {sum(1 for item in items if item['price'])} | written: {target}")
