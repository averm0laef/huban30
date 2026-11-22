"""Builds rehearsal-import.xml and rehearsal-offers.xml (CommerceML 2) in local-data/1c/ from the JSON of the 1С list
export, to rehearse the exchange at full volume on a scratch database. The list export carries no groups, no brands and
no pictures, so the rehearsal checks volume, articles shared by several items, prices and stock — not the group tree.
Usage: python3 scripts/catalog-placement/build-commerceml.py [export.json]"""
import json, pathlib, sys
from xml.sax.saxutils import escape
here = pathlib.Path(__file__).resolve().parents[2] / "local-data" / "1c"      # the owner's data stays outside Git
exports = sorted(here.glob("nomenklatura-*.json"))
source = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (exports[-1] if exports else None)
if source is None:
    sys.exit("No export found: see scripts/catalog-placement/README.md")
items = json.load(open(source, encoding="utf8"))
def num(v):
    try: return float((v or "").replace("\xa0", "").replace(" ", "").replace(",", "."))
    except ValueError: return None
codes = [i["code"] for i in items]
assert len(codes) == len(set(codes)), "1C codes are expected to be unique"
goods, offers = [], []
for i in items:
    name = " ".join(i["name"].split())
    goods.append(f"<Товар><Ид>{escape(i['code'])}</Ид><Артикул>{escape(i['sku'].strip())}</Артикул><Код>{escape(i['code'])}</Код><Наименование>{escape(name)}</Наименование>"
                 + (f"<Описание>{escape(i['note'])}</Описание>" if i["note"] else "") + "</Товар>")
    price, stock = num(i["price"]), num(i["stock"])
    offers.append(f"<Предложение><Ид>{escape(i['code'])}</Ид>"
                  + (f"<Цены><Цена><ИдТипаЦены>t-sell</ИдТипаЦены><ЦенаЗаЕдиницу>{price:.2f}</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена></Цены>" if price else "")
                  + f"<Количество>{stock if stock is not None else 0}</Количество></Предложение>")
head = '<?xml version="1.0" encoding="UTF-8"?>\n<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="2026-11-22T12:00:00">\n'
(here / "rehearsal-import.xml").write_text(head + '<Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование></Классификатор>\n<Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>\n' + "\n".join(goods) + "\n</Товары></Каталог></КоммерческаяИнформация>\n")
(here / "rehearsal-offers.xml").write_text(head + '<ПакетПредложений СодержитТолькоИзменения="false"><Ид>cat</Ид><ТипыЦен><ТипЦены><Ид>t-sell</Ид><Наименование>Оптовая цена</Наименование></ТипЦены></ТипыЦен><Предложения>\n' + "\n".join(offers) + "\n</Предложения></ПакетПредложений></КоммерческаяИнформация>\n")
print("goods:", len(goods), "| offers:", len(offers))
