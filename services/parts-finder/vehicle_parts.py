"""Text lookup for vehicle parts, with a verified local Probox reference."""

import os
import re
import sqlite3
from datetime import datetime, timezone

from fapi_catalog import FapiError, find_part, part_ref
from local_fitment import local_fitments
from part_query import (
    ALIASES, CAPACITY, CHASSIS, ENGINE, MAKES, TO_EN, YEAR, article_candidate, category_matches,
    normalize_query, vehicle_hint, words,
)

CATALOG = "/catalogList/dt/"
DENSO = "https://am.denso.com/search/sof/soundList.cgi?Line=5&maker=01toyota"
TOYOTA_EPC = "https://toyotaepc.com/toyota/probox-succeed/JP/oil-filter"
PROBOX_FILTERS = (
    ("04152-40060", "NSP160V", "1NR-FE", "с 09.2014", DENSO),
    ("90915-10003", "NCP160V NCP165V", "1NZ-FE", "09.2014–02.2023", TOYOTA_EPC),
    ("90915-10009", "NCP160V NCP165V", "1NZ-FE", "с 03.2023", TOYOTA_EPC),
    ("90915-10003", "NHP160V", "1NZ-FXE", "12.2018–02.2023", TOYOTA_EPC),
    ("90915-10009", "NHP160V", "1NZ-FXE", "с 03.2023", TOYOTA_EPC),
    ("90915-10003", "NCP50V", "2NZ-FE", "06.2002–09.2014", DENSO),
    ("90915-10003", "NCP51V NCP55V", "1NZ-FE", "06.2002–09.2014", DENSO),
    ("90915-10003", "NCP52V", "1NZ-FNE", "04.2003–09.2014", DENSO),
    ("90915-10003", "NCP58G NCP59G", "1NZ-FE", "06.2002–10.2013", DENSO),
    ("90915-20003", "NLP51V", "1ND-TV", "06.2002–07.2008", DENSO),
)
PROBOX_ENGINES = {
    "1NR-FE": "1.3 л · бензин", "2NZ-FE": "1.3 л · бензин",
    "1NZ-FE": "1.5 л · бензин", "1NZ-FXE": "1.5 л · гибрид",
    "1NZ-FNE": "1.5 л · газ (CNG)", "1ND-TV": "1.4 л · дизель",
}
PROBOX_FUEL = (
    (("гибрид", "hybrid"), "гибрид"),
    (("дизел", "diesel"), "дизель"),
    (("бензин", "gasoline", "petrol"), "бензин"),
    (("cng",), "газ (CNG)"),
)
MONTH_YEAR = re.compile(r"(?<!\w)(0[1-9]|1[0-2])[./]((?:19|20)\d{2})(?!\w)")
CATEGORIES = (
    ("Масляный фильтр", (("фильтр", "масл"), ("oil", "filter"), ("масляник",), ("маслофильтр",), ("oilfilter",))),
    ("Воздушный фильтр", (("фильтр", "воздуш"), ("air", "filter"), ("воздушник",), ("airfilter",))),
    ("Салонный фильтр", (("фильтр", "салон"), ("cabin", "filter"), ("pollen", "filter"), ("салонник",))),
    ("Топливный фильтр", (("фильтр", "топлив"), ("fuel", "filter"))),
    ("Тормозные колодки", (("колод",), ("brake", "pad"))),
    ("Тормозной диск", (("диск", "тормоз"), ("brake", "disc"), ("brake", "rotor"))),
    ("Свечи зажигания", (("свеч", "зажиган"), ("spark", "plug"))),
    ("Свечи накаливания", (("свеч", "накал"), ("glow", "plug"))),
    ("Амортизатор", (("амортизатор",), ("shock", "absorber"))),
    ("Стойка стабилизатора", (("стойк", "стабилизатор"), ("stabilizer", "link"), ("sway", "link"))),
    ("Ступичный подшипник", (("подшипник", "ступиц"), ("подшипник", "ступич"), ("wheel", "bearing"))),
    ("Щётки стеклоочистителя", (("щетк", "стеклоочистител"), ("дворник",), ("wiper", "blade"))),
)


def contains_words(tokens, sequence):
    return bool(sequence) and any(tokens[index:index + len(sequence)] == sequence for index in range(len(tokens)))


def detect_categories(tokens):
    cabin_air = contains_words(tokens, ["cabin", "air", "filter"])
    return [
        entry for entry in CATEGORIES if category_matches(tokens, entry[1])
        and not (cabin_air and entry[0] == "Воздушный фильтр")
    ]


def probox_filters(text, tokens, choice=None):
    chassis = {token for token in tokens if CHASSIS.fullmatch(token)}
    dates = YEAR.findall(text)
    built = MONTH_YEAR.search(text)
    built_month = (built[2], built[1]) if built else None
    engine_input = ENGINE.search(text)
    capacity_input = CAPACITY.search(text)
    fuel = {label for stems, label in PROBOX_FUEL if any(token.startswith(stems) for token in tokens)}
    choices = []
    for ident, (article, codes, engine, years, source) in enumerate(PROBOX_FILTERS, 1):
        endpoints = YEAR.findall(years)
        months = [(stamp[2], stamp[1]) for stamp in MONTH_YEAR.finditer(years)]
        if (
            (chassis and not any(code.lower() in chassis or code[:-1].lower() in chassis for code in codes.split()))
            or (engine_input and engine_input[0].upper() != engine)
            or (capacity_input and not PROBOX_ENGINES[engine].startswith(capacity_input[1].replace(",", ".") + " "))
            or (fuel and PROBOX_ENGINES[engine].split(" · ")[-1] not in fuel)
            or (len(dates) == 1 and (dates[0] < endpoints[0] or (len(endpoints) > 1 and dates[0] > endpoints[-1])))
            or (built_month and (built_month < months[0] or (len(months) > 1 and built_month > months[-1])))
        ):
            continue
        body = f"{codes.replace(' ', ' / ')} · {years}"
        choices.append((ident, engine, body, {
            "article": article, "brand": "Toyota", "description": f"{body} · {engine}",
            "source": "DENSO" if source == DENSO else "Toyota EPC", "source_url": source, "oem": True,
        }))
    context = {"vehicle": "Toyota Probox", "category": "Масляный фильтр"}
    if not choices:
        return {
            "status": "need_vehicle",
            **context, "message": "Для указанных кузова, двигателя и года нет совместимого варианта. Проверьте данные машины.",
        }
    if choice is not None:
        engines = {}
        for _, engine, _, _ in choices:
            # The first reference for an engine remains its identifier across filtered queries.
            engine_id = next(index for index, record in enumerate(PROBOX_FILTERS, 1) if record[2] == engine)
            codes = {code for record in PROBOX_FILTERS if record[2] == engine for code in record[1].split()}
            body = f" · {', '.join(sorted(codes))}" if len(codes) <= 2 else ""
            engines.setdefault(engine, {"id": engine_id, "label": f"{PROBOX_ENGINES[engine]} · {engine}{body}"})
        picked = selected(engines.values(), choice, "engine")
        if not picked:
            return {**choose("engine", list(engines.values()), {}), **context}
        chosen_engine = next(engine for engine, item in engines.items() if item == picked)
        context["engine"] = picked["label"]
        choices = [item for item in choices if item[1] == chosen_engine]
        if len({item[3]["article"] for item in choices}) > 1:
            versions = [{"id": ident, "label": body} for ident, _, body, _ in choices]
            version = selected(versions, choice, "version")
            if not version:
                return {**choose("version", versions, {"engine": picked["id"]}), **context}
            choices = [item for item in choices if item[0] == version["id"]]
    parts = [item[3] for item in choices]
    if choice is not None and len(parts) > 1:
        parts = [{**parts[0], "description": " · ".join(item[2] for item in choices)}]
    return {
        "status": "reference", **context, "parts": parts,
        "message": "Сверьте кузов и месяц выпуска перед покупкой.",
    }


def catalog_rows(budget, call, name, credits, params=None, key=None):
    rows = budget.fetch(CATALOG + name, params or {}, credits, call)
    if key and isinstance(rows, dict):
        rows = rows.get(key)
    if not isinstance(rows, list):
        raise FapiError(502, "fapi_invalid_response", "FAPI вернул список каталога неизвестного формата.")
    return [row for row in rows if isinstance(row, dict)]


def year_of(milliseconds):
    if type(milliseconds) is int and milliseconds:
        try:
            return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).year
        except (ValueError, OSError, OverflowError):
            pass
    return None


def options(rows, id_key, label_key, *, full=False):
    found = {}
    for row in rows:
        ident, title = row.get(id_key), row.get(label_key)
        if type(ident) is not int or ident <= 0 or not isinstance(title, str) or not title.strip():
            continue
        label = row.get("fd") if full else None
        label = label if isinstance(label, str) and label.strip() else title
        item = {"id": ident, "label": label, "title": title}
        if full:
            start, end = year_of(row.get("cb")), year_of(row.get("ce"))
            engine, capacity = row.get("engineCode"), row.get("capacity")
            if start:
                label += f" · {start}–{end}" if end else f" · с {start}"
            if isinstance(engine, str) and engine and engine not in label:
                label += " · " + engine
            item.update(label=label, start=start, end=end, engine=engine, capacity=capacity)
        found[ident] = item
    return list(found.values())


def selected(available, choice, key, automatic=False):
    if ident := choice.get(key):
        for item in available:
            if item["id"] == ident:
                return item
        raise FapiError(400, "invalid_catalog_choice", "Обновите поиск и выберите вариант из каталога.")
    return available[0] if automatic and len(available) == 1 else None


def choose(key, available, confirmed):
    if available:
        return {"status": "choose", "field": key, "options": available, "choices": confirmed}
    return {"status": "no_data", "message": "В каталоге FAPI для этого запроса нет вариантов."}


def matching_nodes(tree, rules):
    sections = options(tree, "i", "d")
    titles = {item["id"]: item["title"] for item in sections}
    parents = {row["i"]: row["pi"] for row in tree if type(row.get("i")) is int and type(row.get("pi")) is int}
    matches = []
    for item in sections:
        title = words(item["title"])
        if not category_matches(title, rules) or any(
            word.startswith(("корпус", "крыш", "проклад", "уплотн", "housing", "cover", "gasket")) for word in title
        ):
            continue
        path = [item["title"]]
        ancestor = parents.get(item["id"])
        seen = {item["id"]}
        while ancestor in titles and ancestor not in seen:
            seen.add(ancestor)
            path.append(titles[ancestor])
            ancestor = parents.get(ancestor)
        matches.append({**item, "label": " → ".join(reversed(path))})
    return matches


def covers_year(item, year):
    return (item.get("start") is None or item["start"] <= year) and (item.get("end") is None or item["end"] >= year)


def search_vehicle_parts(form, budget, call, *, guided=False):
    query = form.get("query")
    choice = form.get("choices", {})
    if not isinstance(query, str) or not 0 < len(query.strip()) <= 140:
        raise FapiError(400, "invalid_parts_query", "Введите название детали, марку и модель автомобиля.")
    if not isinstance(choice, dict) or any(
        key not in ("make", "model", "modification", "node", "engine", "version", "article", "local_variant")
        or type(value) is not int or value <= 0
        for key, value in choice.items()
    ):
        raise FapiError(400, "invalid_catalog_choice", "Выберите вариант из каталога.")
    corrected, normalized = normalize_query(query, CATEGORIES)
    autodoc = guided and form.get("catalog") == "autodoc"
    categories = detect_categories(normalized)
    if len(categories) == 1 and categories[0][0] == "Масляный фильтр" and "probox" in normalized:
        return probox_filters(corrected, normalized, choice if guided else None)
    hint = vehicle_hint(normalized, CATEGORIES)
    if guided and not categories and not set(hint).intersection(MAKES):
        article = article_candidate(query)
        if article:
            spelling = [{"id": 1, "label": article}]
            if re.search(r"[а-яё]", article, re.I):
                latin = article.lower().translate(TO_EN).upper()
                if converted := article_candidate(latin):
                    spelling.append({"id": 2, "label": converted})
            exact = selected(spelling, choice, "article", automatic=True)
            if not exact:
                return choose("article", spelling, {})
            return {"status": "article", "article": exact["label"]}
    if len(categories) != 1:
        if autodoc and not categories and not set(hint).intersection(MAKES) and re.search(r"[a-z]", query, re.I):
            return {"status": "keyword", "query": query}
        return {
            "status": "need_detail",
            "message": "Укажите одну деталь, например «масляный фильтр Toyota Camry 2019» или «колодки Лада Веста».",
        }
    category = categories[0]
    dates = YEAR.findall(corrected)
    year = int(dates[0]) if len(dates) == 1 else None
    engine_input, capacity_input = ENGINE.search(corrected), CAPACITY.search(corrected)
    liters = float(capacity_input[1].replace(",", ".")) if capacity_input else None
    display_names = {"vw": "Volkswagen", "bmw": "BMW", "rav4": "RAV4"}
    if guided:
        _, car_tokens = normalize_query(ENGINE.sub(" ", CAPACITY.sub(" ", corrected)), CATEGORIES)
        car_words = vehicle_hint(car_tokens, CATEGORIES)
        display = " ".join(display_names.get(token, token.title()) for token in car_words)
        if sum(any(char.isalpha() for char in token) for token in car_words) < 2 and (
            len(car_words) < 2 or car_words[0] not in MAKES
        ):
            if autodoc and not set(car_words).intersection(MAKES):
                return {"status": "keyword", "query": query}
            return {"status": "need_vehicle", "message": "Добавьте марку и модель, например «масляный фильтр Toyota Camry»."}
        try:
            variants = local_fitments(car_words, category[0], year, engine_input[0].upper() if engine_input else None, liters)
        except (OSError, sqlite3.Error):
            raise FapiError(503, "local_fitment_unavailable", "Сейчас недоступен справочник магазина.") from None
        if variants:
            context = {"vehicle": display, "category": category[0]}
            variant = selected(variants.values(), choice, "local_variant")
            if not variant:
                options_list = [{"id": row["id"], "label": row["label"]} for row in variants.values()]
                return {**choose("local_variant", options_list, {}), **context}
            return {
                **context, "vehicle": variant["vehicle"], "engine": variant["label"],
                "status": "reference", "parts": variant["parts"], "message": "По каталогу магазина.",
            }
    if os.getenv("FAPI_FITMENT_ENABLED", "1").strip().lower() in ("0", "off", "false"):
        return {
            "status": "no_data",
            "message": "Для этой машины пока нет данных в местном справочнике. Можно продолжить по известному артикулу.",
        }
    if guided:
        if form.get("confirmed") is not True:
            configuration = [display]
            if year:
                configuration.append(str(year))
            if capacity_input:
                configuration.append(capacity_input[1].replace(".", ",") + " л")
            if engine_input:
                configuration.append(engine_input[0].upper())
            return {
                "status": "confirm", "vehicle": " · ".join(configuration),
                "category": category[0], "message": "Проверьте автомобиль и деталь.",
            }

    if "mercedes" in normalized and "benz" not in normalized:
        normalized.insert(normalized.index("mercedes") + 1, "benz")
    make_rows = catalog_rows(budget, call, "manufacturerList", 3, key="mf")
    makes = [
        item for item in options(make_rows, "dbi", "ds")
        if contains_words(normalized, [ALIASES.get(token, token) for token in words(item["title"])])
    ]
    if not makes:
        return {"status": "need_vehicle", "message": "Укажите марку и модель, например «масляный фильтр Toyota Camry»."}
    make = selected(makes, choice, "make", automatic=True)
    if not make:
        return {**choose("make", makes, {}), "category": category[0]}
    confirmed = {"make": make["id"]}

    model_rows = catalog_rows(budget, call, "modelList", 8, {"mfi": make["id"]}, "m")
    make_words = words(make["title"])
    models = []
    for item in options(model_rows, "dbi", "d", full=True):
        name = words(item["title"].split("(", 1)[0])
        if name[:len(make_words)] == make_words:
            name = name[len(make_words):]
        if name and contains_words(normalized, [ALIASES.get(name[0], name[0])]):
            models.append(item)
    if year:
        models = [item for item in models if covers_year(item, year)]
    if not models:
        return {"status": "need_vehicle", "message": f"В каталоге {make['title']} такой модели или года нет. Проверьте данные."}
    model = selected(models, choice, "model", automatic=True)
    if not model:
        return {**choose("model", models, confirmed), "vehicle": make["label"], "category": category[0]}
    confirmed["model"] = model["id"]

    modification_rows = catalog_rows(budget, call, "modificationList", 8, {"mi": model["id"]}, "m")
    modifications = options(modification_rows, "dbi", "d", full=True)
    if year:
        modifications = [item for item in modifications if covers_year(item, year)]
    if engine_input:
        modifications = [
            item for item in modifications if isinstance(item["engine"], str)
            and engine_input[0].upper() in re.split(r"[,;/\s]+", item["engine"].upper())
        ]
    if capacity_input:
        modifications = [
            item for item in modifications
            if (capacity := re.match(r"\d+(?:[.,]\d+)?", str(item["capacity"] or item["title"])))
            and round(float(capacity[0].replace(",", ".")), 1) == liters
        ]
    modification = selected(modifications, choice, "modification")
    if not modification:
        return {
            **choose("modification", modifications, confirmed), "vehicle": model["label"], "category": category[0],
        }
    confirmed["modification"] = modification["id"]

    tree = catalog_rows(budget, call, "treeList", 8, {"mi": modification["id"]})
    nodes = matching_nodes(tree, category[1])
    if not nodes:
        return {"status": "no_data", "message": "Для этой модификации FAPI не показал подходящую группу деталей."}
    node = selected(nodes, choice, "node", automatic=True)
    if not node:
        return {
            **choose("node", nodes, confirmed), "vehicle": modification["label"], "category": category[0],
        }
    rows = catalog_rows(budget, call, "productList", 8, {"modi": modification["id"], "nodei": node["id"]})
    parts = {}
    for row in rows:
        if part := part_ref({**row, "ds": row.get("mfd")}):
            parts[(part["manufacturer_id"], part["article"])] = part
    return {
        "status": "found", "vehicle": modification["label"], "category": node["title"],
        "parts": list(parts.values())[:120],
        "message": "Список FAPI для выбранной модификации. Перед покупкой сверьте применимость детали.",
    }
