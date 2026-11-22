"""Storefront vocabulary for catalogue-wide Autodoc keyword searches."""

import re

from part_query import normalize_query
from vehicle_parts import CATEGORIES, detect_categories

MARKETS = ("uk", "de", "es")
LABELS = {
    "Масляный фильтр": ("oil filter", "Ölfilter", "filtro de aceite"),
    "Воздушный фильтр": ("air filter", "Luftfilter", "filtro de aire"),
    "Салонный фильтр": ("cabin air filter", "Innenraumfilter", "filtro de habitáculo"),
    "Топливный фильтр": ("fuel filter", "Kraftstofffilter", "filtro de combustible"),
    "Тормозные колодки": ("brake pads", "Bremsbeläge", "pastillas de freno"),
    "Тормозной диск": ("brake discs", "Bremsscheiben", "discos de freno"),
    "Свечи зажигания": ("spark plugs", "Zündkerzen", "bujías de encendido"),
    "Свечи накаливания": ("glow plugs", "Glühkerzen", "bujías de precalentamiento"),
    "Амортизатор": ("shock absorbers", "Stoßdämpfer", "amortiguadores"),
    "Стойка стабилизатора": ("anti-roll bar link", "Koppelstange", "bieleta de suspensión"),
    "Ступичный подшипник": ("wheel bearing", "Radlager", "cojinete de rueda"),
    "Щётки стеклоочистителя": ("wiper blades", "Scheibenwischer", "escobillas limpiaparabrisas"),
}
PART_BRANDS = {"bosch", "mann", "ridex", "brembo", "ate", "trw", "denso", "ngk", "sachs", "mahle", "filtron"}
BRAND_ALIASES = {"бош": "bosch", "брембо": "brembo", "денсо": "denso", "манн": "mann", "фильтрон": "filtron"}


def autodoc_term(query, market):
    corrected, tokens = normalize_query(query, CATEGORIES)
    candidates = detect_categories(tokens)
    if len(candidates) != 1:
        return query if not re.search(r"[а-яё]", corrected, re.I) else None
    brand = next((item for token in tokens if (item := BRAND_ALIASES.get(token, token)) in PART_BRANDS), "")
    names = [LABELS[candidates[0][0]][MARKETS.index(market)]]
    front = {"front", "передние", "передний"}.intersection(tokens)
    rear = {"rear", "задние", "задний"}.intersection(tokens)
    if bool(front) != bool(rear):
        position = ("front", "vorne", "delanteros") if front else ("rear", "hinten", "traseros")
        names.append(position[MARKETS.index(market)])
    if brand:
        names.insert(0, brand)
    return " ".join(names)
