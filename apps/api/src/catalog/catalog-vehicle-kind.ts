// What kind of vehicle a product is for: a passenger car, a truck, or a tractor and other machinery.
//
// The owner's 1С base already says it — its top groups are «01. Легковая», «02. Грузовики», «25. Камаз», «МТЗ»,
// «27. Сельхозтехника» — so the group chain of a product is asked first. A product whose groups say nothing (and
// every product of a base loaded without groups) is read by the make its NAME calls: «… КАМАЗ», «… МТЗ-82»,
// «… Toyota Corolla». That is what the name says, not a confirmed fitment, and the storefront words it so.
//
// The make words below stand in migration 0053 as well (the backfill of products already loaded): change both.
import type { CatalogVehicleKind } from "@an30/contracts";

import { cleanGroupName } from "./catalog-group-names.js";

/** Asked in this order: «Спец техника» inside «Грузовики» is machinery, a tyre «для МТЗ и КАМАЗ» is a tractor's. */
const KIND_ORDER: readonly CatalogVehicleKind[] = ["tractor", "truck", "passenger"];

const GROUP_WORDS: Readonly<Record<CatalogVehicleKind, RegExp>> = {
  passenger: /легков|отечественные авто|(?<![a-zа-я0-9])(?:уаз|ва[з3])(?![a-zа-я])/u,
  tractor: /(?<![a-zа-я0-9])[мm][тt][з3z](?![a-zа-я0-9])|сельхоз|спец\s?техник|трактор|кировец|погрузчик/u,
  truck: /грузов|камаз|ком+ерческ|газель/u,
};

export const VEHICLE_KIND_NAME_WORDS: Readonly<Record<CatalogVehicleKind, readonly string[]>> = {
  passenger: [
    "ваз", "лада", "lada", "нива", "уаз", "москвич", "волга", "toyota", "nissan", "honda", "mazda", "mitsubishi", "subaru",
    "suzuki", "daihatsu", "lexus", "infiniti", "hyundai", "kia", "daewoo", "chevrolet", "ford", "volkswagen", "vw", "audi",
    "bmw", "mercedes", "renault", "skoda", "opel", "peugeot", "geely", "chery", "haval",
  ],
  tractor: [
    "мтз", "юмз", "лтз", "т-16", "т-25", "т-40", "т-150", "дт-75", "к-700", "к-701", "к-744", "кировец", "беларус",
    "трактор", "трактора", "тракторный", "тракторная", "комбайн", "комбайна", "экскаватор", "экскаватора", "погрузчик",
    "погрузчика", "бульдозер", "бульдозера", "xcmg", "sdlg", "lonking", "zl-30", "zl-50",
  ],
  truck: [
    "камаз", "kamaz", "маз", "краз", "урал", "зил", "газон", "газель", "валдай", "газ-53", "газ-3307", "газ-3309", "howo",
    "shacman", "shaanxi", "sitrak", "faw", "dongfeng", "foton", "scania", "daf", "iveco", "hino", "isuzu", "fuso",
  ],
};

const NAME_WORDS = new Map(KIND_ORDER.map((kind) => [
  kind,
  new RegExp(`(?<![a-zа-я0-9])(?:${VEHICLE_KIND_NAME_WORDS[kind].join("|")})(?![a-zа-я])`, "u"),
]));

const fold = (text: string) => text.toLowerCase().replaceAll("ё", "е");

/** The kind the product's 1С groups name — its own group and every parent up to the root — or null. */
export function vehicleKindOfGroups(groupNames: readonly string[]): CatalogVehicleKind | null {
  const names = groupNames.map((name) => fold(cleanGroupName(name)));
  return KIND_ORDER.find((kind) => names.some((name) => GROUP_WORDS[kind].test(name))) ?? null;
}

/** The kind of the make the name calls («… КАМАЗ-5320», «… МТЗ», «… Toyota»), or null when it calls none. */
export function vehicleKindOfName(productName: string): CatalogVehicleKind | null {
  const name = fold(productName);
  return KIND_ORDER.find((kind) => NAME_WORDS.get(kind)!.test(name)) ?? null;
}

/** The 1С groups first — the owner filed the product there himself — then the name. */
export function vehicleKindOf(input: { groupNames: readonly string[]; productName: string }): CatalogVehicleKind | null {
  return vehicleKindOfGroups(input.groupNames) ?? vehicleKindOfName(input.productName);
}
