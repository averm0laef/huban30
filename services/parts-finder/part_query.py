"""Interpret parts queries locally before looking up catalogue data."""

import re
import unicodedata

EN_KEYS = "`qwertyuiop[]asdfghjkl;'zxcvbnm,."
RU_KEYS = "ёйцукенгшщзхъфывапролджэячсмитьбю"
TO_RU = str.maketrans(EN_KEYS, RU_KEYS)
TO_EN = str.maketrans(RU_KEYS, EN_KEYS)
LOOKALIKE = str.maketrans("авекмнорстух", "abekmhopctyx")
LAYOUT_WORD = re.compile(r"[^\W_]+(?:[.,;'\[\]`]+[^\W_]+)*")
YEAR = re.compile(r"(?<!\w)(?:19|20)[0-9]{2}(?!\w)")
ENGINE = re.compile(r"\b(?:[0-9][a-z]{1,3}|[a-z][0-9][a-z0-9]{0,3}|[a-z]{2,3}[0-9]{1,3})-[a-z0-9]{2,4}\b")
CHASSIS = re.compile(r"\b(?:ncp|nsp|nhp|nlp)[0-9]{2,3}[vg]?\b")
CAPACITY = re.compile(r"(?<!\w)([0-9][.,][0-9])(?:\s*(?:л|l)(?!\w)|(?=\s|$))")
ENGINE_FRAGMENT = re.compile(r"\b[^\W_]{2,5}-[^\W_]{2,4}\b")

MODEL_MAKES = {
    "probox": "toyota", "camry": "toyota", "corolla": "toyota", "rav4": "toyota", "yaris": "toyota",
    "civic": "honda", "accord": "honda", "fit": "honda", "qashqai": "nissan", "tiida": "nissan",
    "polo": "vw", "golf": "vw", "tiguan": "vw", "solaris": "hyundai",
    "vesta": "lada", "granta": "lada", "largus": "lada", "logan": "renault", "duster": "renault",
    "focus": "ford", "octavia": "skoda", "rapid": "skoda",
}
ALIASES = {
    "тойота": "toyota", "тойоты": "toyota", "тоёта": "toyota", "тоета": "toyota",
    "пробокс": "probox", "пробокса": "probox", "пробоксу": "probox", "прабокс": "probox",
    "プロボックス": "probox", "proboks": "probox", "praboks": "probox",
    "камри": "camry", "королла": "corolla", "короллу": "corolla", "короллы": "corolla",
    "рав4": "rav4", "ярис": "yaris", "хонда": "honda", "сивик": "civic", "аккорд": "accord", "фит": "fit",
    "ниссан": "nissan", "кашкай": "qashqai", "ноут": "note", "тиида": "tiida",
    "фольксваген": "vw", "volkswagen": "vw", "поло": "polo", "гольф": "golf", "тигуан": "tiguan",
    "киа": "kia", "рио": "rio", "хендай": "hyundai", "хундай": "hyundai", "солярис": "solaris",
    "лада": "lada", "ваз": "lada", "веста": "vesta", "весту": "vesta", "гранта": "granta", "ларгус": "largus",
    "рено": "renault", "логан": "logan", "дастер": "duster", "форд": "ford", "фокус": "focus",
    "шкода": "skoda", "октавия": "octavia", "рапид": "rapid", "мазда": "mazda", "митсубиси": "mitsubishi",
    "субару": "subaru", "сузуки": "suzuki", "мерседес": "mercedes", "бмв": "bmw", "ауди": "audi",
    "чери": "chery", "джили": "geely", "хавал": "haval", "чанган": "changan", "джак": "jac",
    "джолион": "jolion", "тигго": "tiggo", "монжаро": "monjaro", "кулрей": "coolray", "атлас": "atlas",
    "demio": "demio", "демио": "demio", "аксела": "axela", "атенза": "atenza",
    "филтр": "фильтр", "фильр": "фильтр", "филтер": "фильтр", "filtr": "фильтр", "maslyany": "масляный",
    "maslyanyi": "масляный", "maslyaniy": "масляный", "maslyanyy": "масляный", "маслофильтр": "маслофильтр",
}
MAKES = set(MODEL_MAKES.values()) | {
    "audi", "bmw", "changan", "chery", "chevrolet", "citroen", "datsun", "fiat", "geely", "haval", "jac",
    "kia", "lexus", "mazda", "mercedes", "mitsubishi", "opel", "peugeot", "subaru", "suzuki", "volvo",
}
VEHICLE_WORDS = MAKES | set(MODEL_MAKES) | set(ALIASES.values()) | {"rio", "note"}
FILLER = {
    "на", "для", "к", "в", "и", "двигатель", "двигателя", "мотор", "год", "года", "г", "for", "the", "л", "l",
    "bosch", "бош", "mann", "манн", "denso", "денсо", "ridex", "brembo", "брембо", "ate", "trw", "mahle", "ngk",
    "filtron", "фильтрон", "sachs", "front", "rear", "передние", "передний", "задние", "задний",
}


def words(value):
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).casefold().replace("ё", "е"))


def category_matches(tokens, rules):
    return any(all(any(token.startswith(stem) for token in tokens) for stem in rule) for rule in rules)


def one_typo(word, target):
    if abs(len(word) - len(target)) > 1:
        return False
    if len(word) == len(target):
        mismatches = [i for i, (a, b) in enumerate(zip(word, target)) if a != b]
        return len(mismatches) == 1 or (
            len(mismatches) == 2 and mismatches[1] == mismatches[0] + 1
            and word[mismatches[0]:mismatches[1] + 1] == target[mismatches[0]:mismatches[1] + 1][::-1]
        )
    short, long = sorted((word, target), key=len)
    return any(long[:i] + long[i + 1:] == short for i in range(len(long)))


def normalize_query(query, categories):
    stems = {stem for _, rules in categories for rule in rules for stem in rule}

    def recognized(token):
        return token in VEHICLE_WORDS or token in FILLER or bool(CHASSIS.fullmatch(token)) or any(
            token.startswith(stem) for stem in stems
        )

    def fix(match):
        fragment = match[0]
        for candidate in (fragment, fragment.translate(LOOKALIKE), fragment.translate(TO_RU), fragment.translate(TO_EN)):
            if len(tokens := words(candidate)) == 1:
                token = ALIASES.get(tokens[0], tokens[0])
                if recognized(token):
                    return token
        # Correct short edits only in known words and only when the result is unambiguous.
        if len(fragment) >= 5 and fragment.isalpha():
            matches = {
                ALIASES.get(token, token) for token in (VEHICLE_WORDS | ALIASES.keys())
                if len(token) >= 5 and one_typo(fragment, token)
            }
            if len(matches) == 1:
                return matches.pop()
        return fragment

    def fix_engine(match):
        for spelling in (match[0], match[0].translate(LOOKALIKE), match[0].translate(TO_EN)):
            if ENGINE.fullmatch(spelling):
                return spelling
        return match[0]

    text = ENGINE_FRAGMENT.sub(fix_engine, unicodedata.normalize("NFKC", query).casefold())
    corrected = LAYOUT_WORD.sub(fix, text)
    tokens = words(corrected)
    explicit_makes = set(tokens) & MAKES
    inferred_makes = {MODEL_MAKES[token] for token in tokens if token in MODEL_MAKES}
    if not explicit_makes and len(inferred_makes) == 1:
        tokens.insert(0, next(iter(inferred_makes)))
    return corrected, tokens


def vehicle_hint(tokens, categories):
    part_words = {stem for _, rules in categories for rule in rules for stem in rule}
    return [
        token for token in tokens if token not in FILLER and (not token.isnumeric() or len(token) <= 3)
        and not any(token.startswith(stem) for stem in part_words)
    ]


def article_candidate(query):
    text = unicodedata.normalize("NFKC", query).strip()
    if not re.fullmatch(r"[\w ./-]{1,64}", text) or not re.search(r"[0-9]", text):
        return None
    chunks = words(text)
    if ENGINE.fullmatch(text.lower()) or CHASSIS.fullmatch(text.lower()) or re.fullmatch(
        r"[A-HJ-NPR-Z0-9]{17}|[A-Za-z]{2,5}\d{2,4}[A-Za-z]?-\d{5,}", text, re.I
    ):
        return None
    if sum(chunk.isalpha() for chunk in chunks) > 1 or len([chunk for chunk in chunks if chunk.isalnum() and not chunk.isnumeric()]) > 2:
        return None
    return text
