"""Decode full VINs using one vehicle-data source at a time."""

import re

from vininfo import Vin

VIN_PATTERN = re.compile(r"[A-HJ-NPR-Z0-9]{17}", re.ASCII)
CHASSIS_PATTERN = re.compile(r"[A-Z0-9]{2,12}-[0-9]{4,10}", re.ASCII)
CHASSIS_DASHES = str.maketrans("–—‑−", "----")
CHECK_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
CHECK_VALUES = dict(zip("ABCDEFGHJKLMNPRSTUVWXYZ", map(int, "12345678123457923456789")))

# NHTSA's flat API names and its database variable names can differ.
VPIC_FIELDS = {
    "make": ("Make",),
    "model": ("Model",),
    "model_year": ("ModelYear", "Model Year"),
    "trim": ("Trim",),
    "series": ("Series",),
    "body": ("BodyClass", "Body Class"),
    "vehicle_type": ("VehicleType", "Vehicle Type"),
    "doors": ("Doors",),
    "engine_cylinders": ("EngineCylinders", "Engine Number of Cylinders"),
    "engine_hp": ("EngineHP", "Engine Brake (hp) From"),
    "engine_model": ("EngineModel", "Engine Model"),
    "engine_configuration": ("EngineConfiguration", "Engine Configuration"),
    "displacement_l": ("DisplacementL", "Displacement (L)"),
    "fuel": ("FuelTypePrimary", "Fuel Type - Primary"),
    "transmission": ("TransmissionStyle", "Transmission Style"),
    "transmission_speeds": ("TransmissionSpeeds", "Transmission Speeds"),
    "drive": ("DriveType", "Drive Type"),
    "gvwr": ("GVWR", "Gross Vehicle Weight Rating From"),
    "plant_city": ("PlantCity", "Plant City"),
    "plant_state": ("PlantState", "Plant State"),
    "plant_country": ("PlantCountry", "Plant Country"),
    "manufacturer": ("Manufacturer", "Manufacturer Name"),
}

LOCAL_FIELDS = {
    "Model": "model",
    "Body": "body",
    "Doors": "doors",
    "Engine": "engine_model",
    "Transmission": "transmission",
    "Drive": "drive",
    "Plant": "plant_city",
}


class InvalidVIN(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class VPICUnavailable(Exception):
    pass


def normalize_chassis(raw):
    if not isinstance(raw, str) or len(raw) > 64:
        return None
    candidate = re.sub(r"\s*-\s*", "-", raw.strip().translate(CHASSIS_DASHES))
    if candidate.isascii() and CHASSIS_PATTERN.fullmatch(candidate.upper()):
        return candidate.upper()
    return None


def normalize_vin(raw, *, allow_check_placeholder=False):
    if not isinstance(raw, str) or not raw.strip():
        raise InvalidVIN("invalid_vin", "Введите VIN.")
    supplied = raw.strip()
    if not supplied.isascii():
        raise InvalidVIN("invalid_vin", "Используйте латинские буквы и цифры.")
    vin = supplied.upper()
    if CHASSIS_PATTERN.fullmatch(vin):
        raise InvalidVIN(
            "chassis_number",
            "Это номер шасси. Для его поиска нужна база номеров шасси этой марки.",
        )
    validation_value = vin
    if allow_check_placeholder and vin[8:9] == "?":
        validation_value = vin[:8] + "0" + vin[9:]
    if not VIN_PATTERN.fullmatch(validation_value) or len(set(vin.replace("?", ""))) == 1:
        raise InvalidVIN("invalid_vin", "Введите 17 латинских букв и цифр без I, O и Q.")
    return vin


def check_us_vin(raw):
    if normalize_chassis(raw):
        raise InvalidVIN("chassis_number", "Проверка контрольного символа США требует VIN из 17 символов.")
    vin = normalize_vin(raw, allow_check_placeholder=True)
    total = sum(
        (int(char) if char.isdigit() else CHECK_VALUES[char]) * weight
        for char, weight in zip(vin, CHECK_WEIGHTS)
        if weight
    )
    digit = "0123456789X"[total % 11]
    return {
        "standard": "49 CFR 565.15",
        "expected_check_digit": digit,
        "actual_check_digit": None if vin[8] == "?" else vin[8],
        "matches": None if vin[8] == "?" else vin[8] == digit,
        "vin_with_check_digit": vin[:8] + digit + vin[9:],
    }


def clean_value(value):
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    value = str(value).strip()
    if value.casefold() in {"", "-", "n/a", "not applicable", "not available", "null", "none", "unknown", "unsupportedbrand"}:
        return None
    return value


def model_year(value):
    return int(value) if value and re.fullmatch(r"(?:19|20)[0-9]{2}", value) else None


def decode_local(vin):
    parsed = Vin(vin)
    manufacturer = clean_value(parsed.manufacturer)
    vehicle = {"manufacturer": manufacturer} if manufacturer else {}
    if parsed.details:
        for label, value in parsed.details.annotate().items():
            field = LOCAL_FIELDS.get(label)
            if field and (value := clean_value(value)):
                vehicle[field] = value
    warnings = []
    if vin.startswith("XTA"):
        vehicle["make"] = "LADA"
        if vehicle.get("model"):
            candidates = sorted(parsed.years)
            if vehicle["model"].casefold() == "vesta":
                # The LADA Izhevsk plant started production of Vesta in 2015.
                candidates = [year for year in candidates if year >= 2015]
                if len(candidates) == 1:
                    vehicle["model_year"] = candidates[0]
            if candidates and "model_year" not in vehicle:
                vehicle["model_year_candidates"] = candidates
            if "model_year" not in vehicle:
                warnings.append("model_year_unconfirmed")
    return vehicle, warnings


def decode_vpic(raw):
    vehicle = {}
    for field, names in VPIC_FIELDS.items():
        for name in names:
            if value := clean_value(raw.get(name)):
                vehicle[field] = value
                break
    if "model_year" in vehicle:
        year = model_year(vehicle.pop("model_year"))
        if year:
            vehicle["model_year"] = year

    codes = str(raw.get("ErrorCode") or "").split(",")
    codes = [int(code) for code in codes if re.fullmatch(r"[0-9]{1,3}", code.strip())]
    serious_errors = not codes or any(code not in (0, 1, 10, 14) for code in codes)
    if serious_errors or not (vehicle.get("make") and vehicle.get("model")):
        # vPIC can return speculative models, years and defaults with an unmatched VIN.
        identity = {key: vehicle[key] for key in ("make", "manufacturer") if key in vehicle}
        return identity, "not_assessed", codes

    if 1 in codes:
        check = "mismatch"
    elif 0 in codes:
        check = "match"
    else:
        check = "not_assessed"
    return vehicle, check, codes


def decode_vin(raw, load_vpic):
    vin = normalize_vin(raw)
    local, warnings = decode_local(vin)
    result = {
        "vin": vin,
        "wmi": vin[:3],
        "status": "partial",
        "source": "vininfo",
        "vehicle": local,
        "check_digit": "not_assessed",
        "warnings": warnings.copy(),
    }
    if vin.startswith("XTA") and local.get("model"):
        if local.get("model_year"):
            result["status"] = "decoded"
        return result

    try:
        source, vpic_data = load_vpic(vin)
    except VPICUnavailable:
        if not local:
            raise
        result["warnings"].append("vpic_unavailable")
        return result

    remote, check, codes = decode_vpic(vpic_data)
    if remote.get("model") or (remote and not local.get("model")):
        result.update(source=source, vehicle=remote, check_digit=check, vpic_error_codes=codes)
        result["warnings"] = []
        if check == "mismatch":
            result["warnings"].append("check_digit_mismatch")
        if not codes or any(code not in (0, 1) for code in codes):
            result["warnings"].append("vpic_decode_warning")
        if remote.get("model") and not remote.get("model_year"):
            result["warnings"].append("model_year_unconfirmed")
        if remote.get("make") and remote.get("model") and remote.get("model_year") and not result["warnings"]:
            result["status"] = "decoded"
    elif not local:
        result.update(status="no_data", source=None)
    elif not local.get("model"):
        result["warnings"].append("vpic_model_unavailable")
    return result
