"""Builds rehearsal-import.xml and rehearsal-offers.xml (CommerceML 2) in local-data/1c/ from the JSON of the 1С list
export, to rehearse the exchange at full volume on a scratch database. The list export carries no groups, no brands and
no pictures, so the rehearsal checks volume, articles shared by several items, prices and stock — not the group tree.
Usage: python3 scripts/catalog-placement/build-commerceml.py [export.json]"""
import datetime, json, os, pathlib, sys
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
# The site takes a file it has already loaded for done (by its checksum): a new date makes the same export a new file.
stamp = os.environ.get("AN30_EXPORT_DATE") or datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
head = f'<?xml version="1.0" encoding="UTF-8"?>\n<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="{stamp}">\n'
(here / "rehearsal-import.xml").write_text(head + '<Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование></Классификатор>\n<Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>\n' + "\n".join(goods) + "\n</Товары></Каталог></КоммерческаяИнформация>\n")
(here / "rehearsal-offers.xml").write_text(head + '<ПакетПредложений СодержитТолькоИзменения="false"><Ид>cat</Ид><ТипыЦен><ТипЦены><Ид>t-sell</Ид><Наименование>Оптовая цена</Наименование></ТипЦены></ТипыЦен><Предложения>\n' + "\n".join(offers) + "\n</Предложения></ПакетПредложений></КоммерческаяИнформация>\n")
print("goods:", len(goods), "| offers:", len(offers))

# The same goods the way 1С itself names them in the first real exchange: its own identifier in <Ид>, the code in
# the «Код» requisite (AN30_FIRST_EXCHANGE_CODE=none leaves the code out and writes first-exchange-no-code-*.xml:
# not every 1С setup sends the code), and the
# group tree in the classifier when groups-tree-*.txt is here. The list export does not say which group a product is
# in, so products carry no group. Loaded over a base filled from rehearsal-*.xml it shows what the first exchange
# keeps (apps/api/src/one-c-exchange/one-c-first-exchange.rehearsal.test.ts).
import uuid
guid = lambda kind, value: str(uuid.uuid5(uuid.NAMESPACE_URL, f"an30-rehearsal/{kind}/{value}"))
with_code = os.environ.get("AN30_FIRST_EXCHANGE_CODE", "requisite") != "none"
def groups_xml():
    trees = sorted(here.glob("groups-tree-*.txt"))
    if not trees: return "", 0
    out, depth_open, count = [], [], 0
    for line in trees[-1].read_text(encoding="utf8").splitlines()[1:]:
        name = line.strip()
        if not name: continue
        depth = (len(line) - len(line.lstrip(" "))) // 2
        while depth_open and depth_open[-1] >= depth:
            out.append("</Группы></Группа>"); depth_open.pop()
        count += 1
        out.append(f"<Группа><Ид>{guid('group', f'{count}/{name}')}</Ид><Наименование>{escape(name)}</Наименование><Группы>")
        depth_open.append(depth)
    out.extend("</Группы></Группа>" for _ in depth_open)
    return "<Группы>" + "".join(out) + "</Группы>", count
tree, tree_size = groups_xml()
first = "first-exchange" if with_code else "first-exchange-no-code"
first_goods, first_offers = [], []
for i in items:
    name, ident = " ".join(i["name"].split()), guid("item", i["code"])
    code = f"<ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>Код</Наименование><Значение>{escape(i['code'])}</Значение></ЗначениеРеквизита></ЗначенияРеквизитов>" if with_code else ""
    first_goods.append(f"<Товар><Ид>{ident}</Ид><Артикул>{escape(i['sku'].strip())}</Артикул><Наименование>{escape(name)}</Наименование>"
                       + (f"<Описание>{escape(i['note'])}</Описание>" if i["note"] else "") + code + "</Товар>")
    price, stock = num(i["price"]), num(i["stock"])
    first_offers.append(f"<Предложение><Ид>{ident}</Ид>"
                        + (f"<Цены><Цена><ИдТипаЦены>t-sell</ИдТипаЦены><ЦенаЗаЕдиницу>{price:.2f}</ЦенаЗаЕдиницу><Валюта>RUB</Валюта></Цена></Цены>" if price is not None else "")
                        + f"<Количество>{stock if stock is not None else 0}</Количество></Предложение>")
(here / f"{first}-import.xml").write_text(head + f'<Классификатор><Ид>c</Ид><Наименование>Классификатор</Наименование>{tree}</Классификатор>\n<Каталог СодержитТолькоИзменения="false"><Ид>cat</Ид><Товары>\n' + "\n".join(first_goods) + "\n</Товары></Каталог></КоммерческаяИнформация>\n", encoding="utf8")
(here / f"{first}-offers.xml").write_text(head + '<ПакетПредложений СодержитТолькоИзменения="false"><Ид>cat</Ид><ТипыЦен><ТипЦены><Ид>t-sell</Ид><Наименование>Оптовая цена</Наименование></ТипЦены></ТипыЦен><Предложения>\n' + "\n".join(first_offers) + "\n</Предложения></ПакетПредложений></КоммерческаяИнформация>\n", encoding="utf8")
print("first exchange: goods", len(first_goods), "| groups", tree_size, "| code", "in the «Код» requisite" if with_code else "left out")
