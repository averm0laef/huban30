/**
 * The shop's own dictionary of part names: which storefront section a
 * product belongs to, judged by the noun its 1С name is about
 * («Амортизатор передний KYB 334305», «Рулевой наконечник правый»,
 * «К-т сцепления» → Амортизаторы, Рулевые наконечники, Сцепление).
 *
 * 1С «Управление нашей фирмой» holds the assortment in a few broad groups,
 * so the name is the main witness. The dictionary is written by hand from
 * how parts are named in Russian trade; it is not taken from, and does not
 * depend on, any external parts catalogue.
 *
 * How a name is read:
 *   1. 1С shorthand is spelled out («аморт.», «к-т», «р/к», «подш.»).
 *   2. The head noun is the first Russian word that is not a position or
 *      packaging word («передний», «комплект») and not an adjective
 *      («рулевой», «ступичный»). An unknown noun stops the search: a part
 *      the dictionary does not know is left to the older section rules and,
 *      failing those, to «Без категории» — a wrong shelf is worse than an
 *      honest queue.
 *   3. The noun's entry lists its meanings, most specific first; a meaning
 *      may ask for other words anywhere in the name («подшипник» +
 *      «ступицы» → Ступицы и подшипники). `null` means «a known word, but
 *      this module does not decide it» (oils, filters, lamps: the section
 *      rules in catalog-known-categories.ts read those better).
 */

import { repairMixedScript } from "./catalog-mixed-script.js";

interface Meaning {
  /** Every one of these word starts must be present somewhere in the name. */
  all?: readonly string[];
  /**
   * The shelf of a universal part whose name says nothing about the unit it serves («Сальник 35x50x8», «Подшипник
   * 6205», «Болт М12»): the 1С group the owner filed it under knows better (catalog-known-categories.ts).
   */
  general?: boolean;
  /** Any of these word starts must be present somewhere in the name. */
  has?: readonly string[];
  /** None of these word starts may be present. */
  not?: readonly string[];
  /** A section or subsection slug; null leaves the name to the section rules. */
  slug: string | null;
}

/** [head stems, meanings]. A stem ending in `$` must be the whole word. */
type Entry = readonly [readonly string[], readonly Meaning[]];

const only = (slug: string | null): readonly Meaning[] => [{ slug }];

/** Words that say «for a motorcycle»; «мото» alone would also match «моторное». */
const MOTO = ["мото$", "мотоцикл", "мототехн", "скутер", "мопед", "питбайк", "квадроцикл", "снегоход"] as const;

const ENTRIES: readonly Entry[] = [
  // ---- Suspension ----
  [["амортизатор"], [
    // «Защитный комплект амортизаторов»: the dust boots and bump stops.
    { slug: "opory-i-pylniki", has: ["защитн", "сервисн"] },
    { slug: "gazovye-upory", has: ["багажник", "капот", "крышк", "двер"] },
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "amortizatory" },
  ]],
  [["стойк"], [
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: "kuzovnye-paneli", has: ["кузов", "двер", "лобов"] },
    { slug: "amortizatory" },
  ]],
  [["упор"], [
    { slug: "gazovye-upory", has: ["газов", "капот", "багажник", "крышк", "двер"] },
    { slug: "domkraty", has: ["противооткат", "колес"] },
    { slug: null },
  ]],
  [["пружин"], [
    { slug: "porshnevaya-i-klapany", has: ["клапан"] },
    { slug: "supporty-i-remkomplekty", has: ["тормоз", "колодок", "колодк", "суппорт"] },
    { slug: null, has: ["сцеплен", "замк", "капот", "щетк", "педал", "газа$", "дроссел"] },
    // «Возвратная пружина BPW / SAF / Volvo»: the return spring of a truck's brake shoes.
    { slug: "supporty-i-remkomplekty", has: ["возврат"] },
    { slug: "pruzhiny" },
  ]],
  [["рычаг"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["стеклоочист", "дворник", "щетк"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "переключ", "кулис", "акпп"] },
    // «Рычаг регулировочный (трещетка)»: the slack adjuster of a truck's drum brake.
    { slug: "pnevmotormoza", has: ["регулировочн", "трещетк", "трещотк"] },
    { slug: "tormoznaya-sistema", has: ["тормоз", "ручн", "стояноч"] },
    { slug: "rychagi" },
  ]],
  [["тяга$", "тяги$", "тягу$", "тяге$", "тягой$", "тяг$"], [
    { slug: "rulevye-tyagi", has: ["рулев"] },
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "кулис", "переключ"] },
    { slug: "zamki-i-ruchki", has: ["ручк", "двер", "замк"] },
    { slug: "karbyuratory", has: ["карбюратор"] },
    { slug: "pnevmotormoza", has: ["уровня$"] },
    { slug: "rychagi", has: ["реактив", "попереч", "продольн", "подвеск", "панар", "задн", "развал"] },
    { slug: null },
  ]],
  [["наконечник"], [
    // «Наконечник б/к шины» is the valve of a tubeless tyre; the head of an inflating gun is not.
    { slug: "shinomontazh", has: ["шины$", "шин$", "бескамерн"], not: ["накач", "подкач", "манометр"] },
    { slug: "vysokovoltnye-provoda", has: ["свеч"] },
    { slug: "vyklyuchateli-i-provodka", has: ["провод", "кабел", "клемм", "обжим"] },
    { slug: "kompressory", has: ["подкач", "накач", "насос", "продув"] },
    { slug: "shpritsy-i-maslenki", has: ["шприц"] },
    { slug: "soediniteli-shlangov", has: ["соед$", "соединит"] },
    { slug: null, has: ["шланг", "компрессор"] },
    { slug: "rulevye-nakonechniki" },
  ]],
  [["шаров"], [
    { slug: null, has: ["кран"] },
    { slug: "sharovye-opory" },
  ]],
  [["опор", "опорн"], [
    { slug: "sharovye-opory", has: ["шаров"] },
    // «Опора дифференциала» lies with «подушка дифференциала»; the base misspells the word three ways.
    { slug: "saylentbloki", has: ["дифференц", "дифферинц", "диффиренц", "подрамник"] },
    { slug: "opory-dvigatelya", has: ["двигател", "двс", "кпп", "коробк", "мотор", "раздат", "редуктор", "трансмисс"] },
    { slug: "opory-i-pylniki", has: ["амортизатор", "амортизац", "стойк", "пружин", "проставк"] },
    { slug: "kardannye-valy", has: ["кардан", "вала", "подвесн"] },
    { slug: "ressory", has: ["рессор"] },
    { slug: "gofry-i-krepleniya", has: ["глушител"] },
    { slug: "domkraty", has: ["страховочн", "треног"] },
    { slug: null },
  ]],
  [["подушк"], [
    { slug: "rulevye-reyki-i-gur", has: ["рейк"] },
    { slug: "opory-dvigatelya", has: ["двигател", "двс", "кпп", "коробк", "мотор", "раздат"] },
    // «Подушка воздушная со стаканом» is a truck's air spring.
    { slug: "ressory", has: ["рессор", "пневм", "воздушн"] },
    { slug: "saylentbloki", has: ["дифференц", "дифферинц", "диффиренц", "подрамник"] },
    { slug: "radiatory", has: ["радиатор"] },
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: "gofry-i-krepleniya", has: ["глушител"] },
    { slug: "komfort-v-salone", has: ["сиден", "шею", "шеи", "ортопед", "подголов", "поясниц"] },
    { slug: null },
  ]],
  // «Сайл» is the shop's shorthand; «сайлетблок» its usual typo.
  [["сайлентблок", "сайленблок", "сайлент", "сайлет", "сайл$"], only("saylentbloki")],
  [["втулк"], [
    // «Линк» is the stabiliser link.
    { slug: "stabilizator", has: ["стабилизатор", "линк$", "линка$"] },
    { slug: "ressory", has: ["рессор", "полурессор", "балансир"] },
    { slug: "radiatory", has: ["радиатор"] },
    // «Втулка запорная полуоси» holds the axle shaft's bearing.
    { slug: "stupitsy-i-podshipniki", has: ["запорн", "полуос", "ступиц"] },
    { slug: "povorotnye-kulaki", has: ["кулак", "шкворн", "цапф"], not: ["разжимн"] },
    { slug: "supporty-i-remkomplekty", has: ["направляющ", "суппорт"] },
    { slug: "porshnevaya-i-klapany", has: ["клапан", "шатун"] },
    { slug: "generatory-i-startery", has: ["генератор", "стартер"] },
    { slug: "rulevye-reyki-i-gur", has: ["рулев", "рейк"] },
    { slug: "opory-i-pylniki", has: ["стойк"] },
    { slug: "saylentbloki", has: ["рычаг", "амортизатор", "подвеск", "балк", "тяг", "реактив", "продольн", "сайлентблок", "дифференц"] },
    // «Втулка торсиона» is the radius rod's bush on a Honda; on a KAMAZ cab it is another part.
    { slug: "saylentbloki", has: ["торсион"], not: ["кабин"] },
    { slug: null },
  ]],
  [["стабилизатор"], [
    { slug: null, has: ["напряжен"] },
    { slug: "stabilizator" },
  ]],
  [["линк$", "линки$", "линка$", "линьк"], only("stabilizator")],
  [["ступиц", "полуступиц"], only("stupitsy-i-podshipniki")],
  [["узел$", "узла$", "узлы$"], [
    { slug: "stupitsy-i-podshipniki", has: ["ступич", "ступиц"] },
    { slug: "generatory-i-startery", has: ["щеточн", "стартер", "генератор"] },
    { slug: null },
  ]],
  [["подшипник"], [
    { slug: "stupitsy-i-podshipniki", has: ["ступиц", "ступич", "колес", "полуос"] },
    { slug: "stseplenie", has: ["выжим", "сцеплен"] },
    { slug: "opory-i-pylniki", has: ["амортизатор", "стойк", "опор"], not: ["кардан", "подвесн", "редуктор", "мост$", "моста$"] },
    // «Подшипник подвесной привода»: the support bearing of a long drive shaft.
    { slug: "shrusy-i-privody", all: ["подвесн"], has: ["привод"] },
    { slug: "kardannye-valy", has: ["подвесн", "кардан"] },
    { slug: "generatory-i-startery", has: ["генератор", "стартер"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "первичн", "вторичн", "дифференц", "редуктор", "раздат"] },
    // Whole words: «подшипник роликовый» says how the bearing is built, not that it sits in a roller.
    { slug: "roliki-i-natyazhiteli", has: ["натяж", "ролик$", "ролика$", "роликов$", "грм"] },
    { slug: "konditsioner", has: ["кондиционер", "компрессор"] },
    { slug: "krestoviny-i-podshipniki", general: true },
  ]],
  [["пыльник"], [
    { slug: "pylniki-shrus", has: ["шрус", "привод", "гранат", "полуос"] },
    // «Пыльник наконечника рулевого» is the tie-rod end's boot; «пыльник рулевой тяги» is the rack's.
    { slug: "rulevye-nakonechniki", has: ["наконечник"] },
    { slug: "rulevye-reyki-i-gur", has: ["рулев", "рейк"] },
    { slug: "opory-i-pylniki", has: ["амортизатор", "стойк", "отбойник"] },
    { slug: "supporty-i-remkomplekty", has: ["суппорт", "направляющ", "тормоз"] },
    { slug: "sharovye-opory", has: ["шаров"] },
    { slug: "rulevye-nakonechniki", has: ["наконечник", "тяг"] },
    { slug: "bryzgoviki-i-podkrylki", has: ["двигател", "картер", "крыл"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: "kpp-i-reduktory", has: ["кулис", "кпп", "рычаг"] },
    { slug: null },
  ]],
  [["отбойник"], only("opory-i-pylniki")],
  [["буфер"], [
    { slug: "opory-i-pylniki", has: ["сжат", "амортизатор", "хода", "рессор", "подвеск", "отбой"] },
    { slug: null },
  ]],
  [["рессор", "рессорн", "полурессор", "стремянк", "пневморессор", "пневмоподушк", "пневмобаллон"], only("ressory")],
  [["серьг"], [{ slug: "ressory", has: ["рессор"] }, { slug: null }]],
  [["палец$", "пальцы$", "пальца$"], [
    { slug: "ressory", has: ["рессор"] },
    { slug: "porshnevaya-i-klapany", has: ["поршн"] },
    { slug: "sharovye-opory", has: ["шаров"] },
    { slug: "supporty-i-remkomplekty", has: ["тормоз", "суппорт", "направляющ"] },
    { slug: "rulevye-mehanizmy", has: ["рулев", "реактив"] },
    { slug: null },
  ]],
  [["кулак", "шкворен", "шкворн", "шкворнев", "цапф"], only("povorotnye-kulaki")],

  // ---- Steering ----
  [["рейк"], [
    { slug: null, has: ["багажник", "крыш", "кузов", "строит"] },
    { slug: "rulevye-reyki-i-gur" },
  ]],
  [["гур$", "гидроусилител"], only("rulevye-reyki-i-gur")],
  [["маятник", "сошк"], only("rulevye-mehanizmy")],
  [["демпфер"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "shkivy-i-mahoviki", has: ["коленвал", "шкив", "крутильн"] },
    { slug: null },
  ]],
  [["трапец"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["стеклоочист", "дворник"] },
    { slug: "rulevye-tyagi", has: ["рулев"] },
    { slug: null },
  ]],
  [["вал$", "вала$", "валы$", "валов$"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "kardannye-valy", has: ["кардан"] },
    { slug: "shrusy-i-privody", has: ["привод", "полуос"] },
    { slug: "porshnevaya-i-klapany", has: ["распред", "коленчат", "балансир"] },
    { slug: "kpp-i-reduktory", has: ["первичн", "вторичн", "кпп", "промежуточн", "моста$", "мост$", "редуктор"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: null },
  ]],
  [["ось$", "оси$"], [{ slug: "rychagi", has: ["рычаг"] }, { slug: null }]],
  [["кардан"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "kardannye-valy" },
  ]],

  // ---- Pumps and hoses: one noun, many systems ----
  [["насос"], [
    { slug: "avtonomnye-otopiteli", has: ["автономк", "автономн"] },
    { slug: "rulevye-reyki-i-gur", has: ["гур", "гидроусилител", "рулев"] },
    { slug: "vodyanye-nasosy", has: ["водян", "охлажд", "помп"] },
    // «Насос отопителя доп. электр.»: the heater circuit's auxiliary pump.
    { slug: "radiatory-otopitelya", has: ["отопител", "печк"] },
    { slug: "dizelnaya-apparatura", has: ["тнвд"] },
    { slug: "toplivnye-nasosy", has: ["топлив", "топ$", "бензин", "подкачк", "бензонасос"] },

    { slug: "sistema-smazki", has: ["маслян", "масла"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател", "стеклоомыв"] },
    { slug: "tormoznye-tsilindry", has: ["вакуум"] },
    { slug: "kompressory", has: ["ножн", "ручн", "шин", "велосипед"] },
    { slug: "kanistry-i-voronki", has: ["перекач", "бочк", "канистр", "жидкост", "солярк", "дизтоплив"] },
    // Household water pumps the shop sells next to the garden machines.
    { slug: "sadovaya-tehnika", has: ["вибрационн", "дренажн", "скважин", "погружн", "фекальн"] },
    { slug: null },
  ]],
  [["помп"], only("vodyanye-nasosy")],
  [["бензонасос", "электробензонасос"], only("toplivnye-nasosy")],
  // A hose belongs to the system its name mentions. One that names no system («Шланг синий 10м») is left to the
  // queue: the base sells hoses by the metre for anything, and the cooling shelf would be a guess.
  [["шланг"], [
    { slug: "tormoznye-shlangi", has: ["тормоз"] },
    { slug: "rulevye-reyki-i-gur", has: ["гур", "рулев", "гидроусил"] },
    { slug: "toplivoprovody-i-baki", has: ["топлив", "бензо", "бензин", "маслобензо", "мбс$"] },
    { slug: "stseplenie", has: ["сцеплен", "пгу$"] },
    { slug: "konditsioner", has: ["кондиционер"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател"] },
    { slug: "shpritsy-i-maslenki", has: ["шприц"] },
    { slug: "rashodniki-sadovoy-tehniki", has: ["полив", "садов"] },
    // A hose for blowing the cab out goes with the air tools, whatever it is made of.
    { slug: "kompressory", has: ["продув"] },
    { slug: "patrubki-i-shlangi", has: ["радиатор", "отопител", "отоплен", "печк", "охлажден", "расширительн", "помп", "термостат", "силикон"] },
    { slug: "turbiny", has: ["наддув", "интеркул", "турб"] },
    // «шланг (провод) к прицепу электрический» is a cable.
    { slug: "vyklyuchateli-i-provodka", has: ["электрическ"] },
    // Air lines of a truck or a tractor come before tyre inflation: «от ресивера к компрессору» is a brake line.
    { slug: "pnevmotormoza", has: ["пневм", "воздух", "воздушн", "полуприцеп", "прицеп"] },
    { slug: "kompressory", has: ["подкач", "накач", "компрессор", "насос", "пистолет", "шин", "межколес", "манометр"] },
    { slug: "sistema-smazki", has: ["маслян", "масла"] },
    // «Комплект для ремонта шланга … ёлочка, переходник»: connectors.
    { slug: "soediniteli-shlangov", has: ["ремонт", "елочк", "переходник"] },
    // A hose that names no system is sold by the metre for anything.
    { slug: "trubki-i-shlangi-na-metrazh", general: true },
  ]],
  [["трубк"], [
    { slug: "tormoznye-shlangi", has: ["тормоз"] },
    { slug: "toplivoprovody-i-baki", has: ["топлив"] },
    { slug: "konditsioner", has: ["кондиционер"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател"] },
    { slug: "styazhki-i-izolenta", has: ["термоусад", "кембрик"] },
    { slug: "soediniteli-shlangov", has: ["соединительн", "тройник", "переходн", "уголок"] },
    { slug: "trubki-i-shlangi-na-metrazh", has: ["пвх", "медн", "полиамид"] },
    { slug: null },
  ]],
  // ---- Hoses, fittings and hydraulic lines (the section added with migration 0049) ----
  [["фитинг"], [
    { slug: "bystrosemy", has: ["быстросъем", "быстросьем"] },
    // «Banjo», «BSP», «DK», «DKOL», «JIC» are the standards of hydraulic hose ends.
    { slug: "rvd", has: ["рвд", "banjo", "bsp", "dk$", "dkol", "dkos", "jic$", "высок"] },
    { slug: "fitingi-metallicheskie", has: ["метал", "мет$", "латун", "никел", "бронз"] },
    { slug: "fitingi-pvh", has: ["пвх", "pul", "puc", "put", "пластик"] },
    { slug: "shlangi-i-fitingi" },
  ]],
  [["штуцер"], [
    { slug: "kompressory", has: ["подкач", "накач", "барашк"] },
    { slug: "bystrosemy", has: ["быстросъем", "быстросьем"] },
    { slug: "rvd", has: ["рвд"] },
    { slug: "toplivoprovody-i-baki", has: ["топлив"] },
    // A fitting that names the system it serves belongs to that system.
    { slug: "supporty-i-remkomplekty", has: ["прокачк"] },
    { slug: "tormoznye-tsilindry", all: ["тормоз"], has: ["цилиндр"] },
    { slug: "tormoznye-shlangi", has: ["тормоз"] },
    { slug: "fitingi-metallicheskie", general: true },
  ]],
  [["угольник"], [{ slug: "pnevmotormoza", has: ["тормоз"] }, { slug: "fitingi-metallicheskie", general: true }]],
  [["тройник"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател"] },
    { slug: "derzhateli-i-zaryadki", has: ["прикуриват"] },
    { slug: "soediniteli-shlangov", has: ["шланг"] },
    { slug: "fitingi-metallicheskie", general: true },
  ]],
  [["соединител"], [
    { slug: "bystrosemy", has: ["быстросъем", "быстросьем"] },
    { slug: "tormoznye-shlangi", has: ["тормоз"] },
    { slug: "vyklyuchateli-i-provodka", has: ["провод", "кабел", "клемм"] },
    { slug: "soediniteli-shlangov", has: ["шланг", "елк", "трубк"] },
    { slug: null },
  ]],
  [["переходник"], [
    { slug: "patrubki-i-shlangi", has: ["отопител", "радиатор", "печк"] },
    { slug: "bystrosemy", has: ["быстросъем", "быстросьем"] },
    { slug: "soediniteli-shlangov", has: ["шланг"] },
    { slug: "fitingi-metallicheskie", has: ["резьб"] },
    { slug: null },
  ]],
  [["быстросъем", "быстросьем"], only("bystrosemy")],
  [["пневмо$"], [{ slug: "bystrosemy", has: ["разъем"] }, { slug: null }]],
  [["рвд$"], only("rvd")],
  [["рукав$", "рукава$"], [
    { slug: "turbiny", has: ["наддув", "интеркул", "турб"] },
    // «Рукав ВД DIN 2-SN»: «высокого давления».
    { slug: "rvd", has: ["рвд", "высок", "вд$", "sn$", "2sn", "1sn"] },
    { slug: "trubki-i-shlangi-na-metrazh", general: true },
  ]],
  [["фланец", "фланц"], [
    { slug: "kpp-i-reduktory", has: ["редуктор", "раздат", "кпп", "коробк", "мост$", "моста$", "хвостовик"] },
    { slug: "stupitsy-i-podshipniki", has: ["ступиц"] },
    { slug: "kardannye-valy", has: ["кардан"] },
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп", "приемн"] },
    { slug: "rvd", has: ["нш$", "патрубок"] },
    { slug: null },
  ]],
  // ---- Parking heaters, engine pre-heaters and blankets; garden machines; workshop heaters ----
  [["автономк"], only("avtonomnye-otopiteli")],
  [["отопител"], [{ slug: "radiatory-otopitelya", has: ["радиатор", "кран"] }, { slug: "avtonomnye-otopiteli" }]],
  [["горелк"], [{ slug: "avtonomnye-otopiteli", has: ["автономк", "автономн", "отопител", "планар", "webasto", "eberspacher"] }, { slug: null }]],
  [["утеплител", "автоодеял"], [{ slug: "utepliteli-dvigatelya", has: ["двигател", "автоодеял", "капот"] }, { slug: null }]],
  [["бензопил", "мотопомп", "опрыскивател", "газонокосилк", "культиватор", "мотокос"], only("sadovaya-tehnika")],
  [["пушк"], [{ slug: "garazhnoe-oborudovanie", has: ["теплов"] }, { slug: null }]],
  [["тепловентилятор"], [{ slug: "komfort-v-salone", has: ["автомобильн", "12в$", "12v"] }, { slug: "garazhnoe-oborudovanie" }]],
  [["патрубок", "патрубк"], [
    { slug: "turbiny", has: ["интеркул", "турбин", "турбокомпрессор", "наддув", "ткр$"] },
    { slug: "vpusknaya-sistema", has: ["воздуш", "воздух", "фильтр", "дроссел", "вентиляц", "картер", "сапун"] },
    { slug: "toplivoprovody-i-baki", has: ["топлив", "бензобак", "налив"] },
    { slug: "patrubki-i-shlangi" },
  ]],

  // ---- Brakes ----
  [["колодк", "колодок"], [
    { slug: "vyklyuchateli-i-provodka", has: ["разъем", "провод", "предохранител", "реле", "фишк", "контакт", "клемм"] },
    { slug: "tormoznye-kolodki" },
  ]],
  // Whole words only: «дисковые колодки» is an adjective of the pads.
  [["диск$", "диска$", "диску$", "диском$", "диске$", "диски$", "дисков$", "дискам$", "дисками$", "дисках$"], [
    { slug: "stseplenie", has: ["сцеплен", "ведом", "нажимн"] },
    { slug: "tormoznye-diski", has: ["тормоз", "вентилир", "перфорир"] },
    { slug: "kolesnye-diski", has: ["колес", "литой", "литые", "штампован", "кован", "шина$", "шины$", "шин$"] },
    { slug: "slesarnyy-instrument", has: ["отрезн", "шлифовал", "пильн", "алмазн", "зачистн", "лепестк"] },
    { slug: null },
  ]],
  [["барабан"], only("tormoznye-barabany")],
  [["суппорт"], only("supporty-i-remkomplekty")],
  [["скоб"], [
    { slug: "supporty-i-remkomplekty", has: ["суппорт", "тормоз"] },
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: null },
  ]],
  [["направляющ"], [
    { slug: "supporty-i-remkomplekty", has: ["суппорт", "тормоз"] },
    { slug: "porshnevaya-i-klapany", has: ["клапан"] },
    { slug: null },
  ]],
  [["цилиндр"], [
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: "rulevye-reyki-i-gur", has: ["гур", "рулев"] },
    { slug: "porshnevaya-i-klapany", has: ["блок"] },
    { slug: "tormoznye-tsilindry", has: ["тормоз", "главн", "рабоч", "колесн"] },
    { slug: null },
  ]],
  [["трос"], [
    { slug: "trosy-ruchnika", has: ["ручн", "стояноч", "ручник"] },
    { slug: "zhilety-i-buksirnye-trosy", has: ["буксир"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: "zamki-i-ruchki", has: ["капот", "замк", "двер", "багажник", "лючк", "бензобак"] },
    { slug: "vpusknaya-sistema", has: ["газа", "акселерат", "дроссел"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "переключ", "кулис", "акпп", "селектор"] },
    { slug: "datchiki", has: ["спидометр"] },
    { slug: "radiatory-otopitelya", has: ["печк", "отопител"] },
    { slug: "garazhnoe-oborudovanie", has: ["лебедк", "стальн"] },
    { slug: null },
  ]],
  [["ручник$"], only("trosy-ruchnika")],
  [["усилител"], [
    { slug: "tormoznye-tsilindry", has: ["вакуум", "тормоз"] },
    { slug: "bampery-i-reshetki", has: ["бампер"] },
    { slug: "avtoelektronika", has: ["звук", "сабвуфер", "антен"] },
    { slug: "rulevye-reyki-i-gur", has: ["руля", "рулев"] },
    { slug: null },
  ]],
  [["энергоаккумулятор"], only("pnevmotormoza")],
  [["кран$", "крана$", "краны$"], [
    { slug: "radiatory-otopitelya", has: ["печк", "отопител"] },
    { slug: null, has: ["шаров"] },
    // The air system of a truck and its trailer.
    { slug: "pnevmotormoza", has: ["тормоз", "пневм", "уровня", "влагоотделител", "контурн", "защитн", "прицеп", "разобщительн", "конденсат", "осушител", "воздухораспределител", "растормаж", "ecas$"] },
    { slug: "toplivoprovody-i-baki", has: ["топлив", "бензобак"] },
    { slug: null },
  ]],

  // ---- Engine ----
  [["ремен", "ремн"], [
    { slug: null, has: ["безопасн"] },
    { slug: "bagazhniki-i-farkopy", has: ["стяжн", "груз", "багаж", "храпов"] },
    { slug: "zhilety-i-buksirnye-trosy", has: ["буксир"] },
    { slug: "remni" },
  ]],
  [["ролик"], [
    { slug: "zamki-i-ruchki", has: ["двер", "сдвижн"] },
    { slug: "roliki-i-natyazhiteli" },
  ]],
  [["натяжител", "гидронатяжител", "успокоител"], only("roliki-i-natyazhiteli")],
  [["башмак"], [
    { slug: "roliki-i-natyazhiteli", has: ["цеп", "грм", "натяж"] },
    { slug: "domkraty", has: ["противооткат"] },
    { slug: null },
  ]],
  [["грм$"], only("grm")],
  [["цеп$", "цепь$", "цепи$", "цепей$"], [
    { slug: "tsepi-i-shiny-pil", has: ["пил", "бензопил", "звен"] },
    { slug: "zapchasti-moto", has: [...MOTO, "велосипед"] },
    { slug: "shiny-i-diski", has: ["противоскольж", "снег"] },
    { slug: "grm", has: ["грм", "распред", "привод", "газораспред", "двигател", "маслян"] },
    { slug: null },
  ]],
  [["звездочк"], [
    { slug: "tsepi-i-shiny-pil", has: ["пил", "бензопил"] },
    { slug: "zapchasti-moto", has: [...MOTO, "велосипед"] },
    { slug: "grm", has: ["грм", "распредвал", "коленвал", "цеп"] },
    { slug: null },
  ]],
  [["шестерн"], [
    { slug: "grm", has: ["грм", "распредвал", "коленвал", "маслонасос"] },
    { slug: "generatory-i-startery", has: ["стартер"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "передач", "дифференц", "спидометр", "редуктор", "раздат", "главн", "коронн", "моста$", "мост$", "хвостовик", "полуос", "сателлит"] },
    { slug: null },
  ]],
  [["прокладк"], [
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп", "приемн", "выпускн"] },
    { slug: "prokladki-i-salniki", general: true },
  ]],
  // A seal belongs to the unit it seals. Engine words come first: «сальник коленвала коробка» names the crankshaft's
  // gearbox end. A seal with no unit named («Сальник 30*52*10») stays on the general shelf.
  [["сальник", "манжет"], [
    { slug: "rulevye-reyki-i-gur", has: ["рулев", "гур$", "гидроусил"] },
    { slug: "prokladki-i-salniki", has: ["коленвал", "коленчат", "распредвал", "распределительн", "клапан", "свечн", "маслонасос"] },
    { slug: "dizelnaya-apparatura", has: ["тнвд"] },
    { slug: "generatory-i-startery", has: ["генератор", "стартер"] },
    { slug: "stupitsy-i-podshipniki", has: ["ступиц", "ступич", "колес"] },
    { slug: "povorotnye-kulaki", has: ["кулак"] },
    { slug: "shrusy-i-privody", has: ["привод", "полуос", "шрус"] },
    { slug: "kpp-i-reduktory", has: ["хвостовик", "редуктор", "раздат", "дифференциал", "первичн", "вторичн", "кпп", "мкпп", "акпп", "гидромуфт", "мост$", "моста$"] },
    { slug: "amortizatory", has: ["амортизатор"] },
    { slug: "prokladki-i-salniki", general: true },
  ]],
  // «Колпачек» is the base's usual misspelling.
  [["колпачк", "колпачок", "колпачек"], [
    { slug: "shinomontazh", has: ["вентил", "ниппел", "колес"] },
    { slug: "vysokovoltnye-provoda", has: ["свеч"] },
    { slug: "prokladki-i-salniki", has: ["маслосъем", "маслосьем", "маслоотраж", "клапан"] },
    { slug: null },
  ]],
  [["кольц"], [
    { slug: "porshnevaya-i-klapany", has: ["поршн"] },
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп", "приемн", "коллектор"] },
    { slug: "kolesnyy-krepezh", has: ["центровоч", "центрирующ", "проставоч"] },
    { slug: "datchiki", has: ["abs", "абс"] },
    { slug: "stupitsy-i-podshipniki", has: ["полуос", "ступиц"] },
    { slug: "kpp-i-reduktory", has: ["кпп$"] },
    { slug: "bolty-i-gayki", has: ["стопорн"] },
    // «Кольцо свечного колодца», «кольцо трамблера» are seals.
    { slug: "prokladki-i-salniki", has: ["уплотн", "резин", "форсун", "медн", "свечн", "трамблер"] },
    { slug: null },
  ]],
  [["шайб"], [
    { slug: "prokladki-i-salniki", has: ["медн", "уплотн", "форсун", "пробк", "сливн"] },
    { slug: "bolty-i-gayki", general: true },
  ]],
  [["поршен", "поршн", "поршнев"], [
    { slug: "supporty-i-remkomplekty", has: ["суппорт", "тормоз"] },
    { slug: "porshnevaya-i-klapany" },
  ]],
  [["вкладыш", "гильз", "шатун", "коленвал", "распредвал", "гидрокомпенсатор", "толкател", "коромысл", "рокер", "гбц$"], only("porshnevaya-i-klapany")],
  [["клапан"], [
    { slug: "vpusknaya-sistema", has: ["egr", "егр", "рециркуляц", "холост", "рхх", "вентиляц", "pcv", "картер"] },
    // The metering valve of a diesel's fuel pump.
    { slug: "dizelnaya-apparatura", has: ["дозирован", "тнвд"] },
    { slug: "toplivoprovody-i-baki", has: ["адсорбер", "продувк", "топлив", "бензобак"] },
    { slug: "radiatory-otopitelya", has: ["печк", "отопител"] },
    { slug: "sistema-smazki", has: ["редукцион", "маслян"] },
    { slug: "turbiny", has: ["турбин", "наддув"] },
    // The return and overflow valves of a diesel's injection pump.
    { slug: "dizelnaya-apparatura", has: ["тнвд", "обратк", "перепускн", "нагнетательн"] },
    { slug: "zvukovye-signaly", has: ["сигнал"] },
    // Air system of a truck: drain, levelling and protection valves, ABS modulators.
    { slug: "pnevmotormoza", has: ["тормоз", "растормаж", "прицеп", "пневм", "ускорител", "защитн", "конденсат", "уровня$", "многоциклов", "водоотводн", "abs$", "wabco", "осушител"] },
    { slug: "konditsioner", has: ["кондиционер"] },
    // «Клапан вып», «Клапан IN»: an engine's exhaust and intake valves; «изменения фаз ГРМ» is the VVT valve.
    { slug: "porshnevaya-i-klapany", has: ["впуск", "выпуск", "вып$", "вп$", "in$", "ex$", "vvt", "vvti", "фаз$", "грм$"] },
    { slug: null },
  ]],
  [["головк"], [
    { slug: "porshnevaya-i-klapany", has: ["блок", "цилиндр"] },
    { slug: null, has: ["компрессор", "звукоснимат", "магнит"] },
    { slug: "klyuchi-i-golovki" },
  ]],
  [["маховик", "венец"], only("shkivy-i-mahoviki")],
  [["шкив"], [
    { slug: "generatory-i-startery", has: ["генератор"] },
    { slug: "shkivy-i-mahoviki" },
  ]],
  [["муфт"], [
    { slug: "generatory-i-startery", has: ["генератор", "обгон"] },
    { slug: "ventilyatory", has: ["вентилятор", "вязкост"] },
    { slug: "konditsioner", has: ["кондиционер", "компрессор"] },
    { slug: "kardannye-valy", has: ["кардан", "эластич"] },
    { slug: "stseplenie", has: ["сцеплен", "выжим"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "синхрон", "моста$", "мост$"] },
    { slug: "rvd", has: ["рвд", "1sn", "2sn", "2sc"] },
    { slug: "bystrosemy", has: ["быстросъем", "быстросьем"] },
    // «Муфта разрывная (воздушная) на прицеп»: the air coupling of a trailer.
    { slug: "pnevmotormoza", has: ["разрывн", "прицеп"] },
    { slug: "soediniteli-shlangov", has: ["шланг"] },
    { slug: null },
  ]],
  [["вискомуфт"], only("ventilyatory")],
  [["поддон"], [
    { slug: "kpp-i-reduktory", has: ["акпп", "кпп", "коробк"] },
    { slug: "sistema-smazki" },
  ]],
  [["маслоприемник", "маслоохладител", "теплообменник", "маслонасос"], only("sistema-smazki")],
  [["щуп"], [
    { slug: "sistema-smazki", has: ["маслян", "масла", "уровн", "акпп", "двигател"] },
    // Feeler gauges.
    { slug: "diagnostika", has: ["измерит", "набор", "мм$"] },
    { slug: null },
  ]],
  [["пробк"], [
    { slug: "sistema-smazki", has: ["сливн", "поддон", "картер", "маслян", "масла", "маслозалив"] },
    { slug: "rasshiritelnye-bachki", has: ["радиатор", "расширит", "бачк"] },
    { slug: "toplivoprovody-i-baki", has: ["бензобак", "топлив", "бака"] },
    { slug: null },
  ]],
  [["крышк"], [
    { slug: "rasshiritelnye-bachki", has: ["радиатор", "расширит", "бачк"] },
    { slug: "stupitsy-i-podshipniki", has: ["ступиц"] },
    { slug: "termostaty", has: ["термостат"] },
    { slug: "toplivnye-nasosy", has: ["бензонасос"] },
    { slug: "toplivoprovody-i-baki", has: ["бензобак", "топливн", "бака"] },
    // «Крышка масла», «маслозаливной горловины» (the base also types «маслозолевной»).
    { slug: "sistema-smazki", has: ["маслозал", "маслозол", "маслян", "масла$"] },
    { slug: "kpp-i-reduktory", has: ["первичн", "вторичн", "кпп$"] },
    { slug: "tramblery-i-kommutatory", has: ["трамблер", "распределител"] },
    { slug: "porshnevaya-i-klapany", has: ["клапан"] },
    { slug: "kuzovnye-paneli", has: ["багажник"] },
    { slug: "generatory-i-startery", has: ["генератор", "стартер"] },
    { slug: "provoda-i-klemmy", has: ["аккумулятор", "акб", "клемм"] },
    { slug: null },
  ]],
  [["турбин", "турбокомпрессор", "интеркулер"], only("turbiny")],
  [["картридж"], [
    { slug: "turbiny", has: ["турбин"] },
    { slug: "amortizatory", has: ["амортизатор"] },
    { slug: "opory-dvigatelya", has: ["подушк"] },
    { slug: "pnevmotormoza", has: ["осушител"] },
    { slug: null },
  ]],
  [["заслонк"], [
    { slug: "vpusknaya-sistema", has: ["дроссел"] },
    { slug: "radiatory-otopitelya", has: ["печк", "отопител"] },
    { slug: null },
  ]],
  // «Ремкомплект двигателя / ДВС» is the engine's gasket set; a whole engine has no shelf.
  [["двигател", "двс$"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["стеклоочист", "трапец"] },
    { slug: "ventilyatory", has: ["отопител", "печк", "вентилятор"] },
    { slug: "prokladki-i-salniki", has: ["ремкомплект", "прокладок", "прокладк"] },
    { slug: null },
  ]],
  [["дроссел", "воздуховод", "сапун"], only("vpusknaya-sistema")],
  [["коллектор"], [
    { slug: "vpusknaya-sistema", has: ["впуск"] },
    { slug: "truby-i-kollektory", has: ["выпуск", "выхлоп"] },
    { slug: null },
  ]],
  [["корпус"], [
    { slug: "termostaty", has: ["термостат"] },
    { slug: "vpusknaya-sistema", has: ["воздуш", "дроссел"] },
    { slug: "sistema-smazki", has: ["маслян"] },
    { slug: "zerkala", has: ["зеркал"] },
    { slug: "fary-i-fonari", has: ["фар", "фонар"] },
    { slug: "predohraniteli-i-rele", has: ["предохранител"] },
    { slug: null },
  ]],

  // ---- Ignition ----
  [["свеч"], [
    { slug: "svechi-nakala", has: ["накал"] },
    { slug: null, has: ["ароматич", "восков"] },
    { slug: "svechi-zazhiganiya" },
  ]],
  [["катушк"], [
    { slug: "rashodniki-sadovoy-tehniki", has: ["триммер", "леск"] },
    { slug: null, has: ["рыболов", "кабел", "удлинител", "удочк", "спиннинг"] },
    { slug: "katushki-zazhiganiya" },
  ]],
  [["модул"], [
    { slug: "katushki-zazhiganiya", has: ["зажиган"] },
    { slug: "toplivnye-nasosy", has: ["топлив", "бензонасос", "погружн"] },
    { slug: "bloki-upravleniya", has: ["управлен"] },
    { slug: null },
  ]],
  [["бронепровод"], only("vysokovoltnye-provoda")],
  [["провод$", "провода$", "проводов$", "проводка$", "проводки$"], [
    { slug: "vysokovoltnye-provoda", has: ["высоковольт", "зажиган", "свеч", "напряжен"] },
    { slug: "provoda-i-klemmy", has: ["пусков", "прикурив", "запуск", "масс", "минус", "акб", "аккумулятор", "силов"] },
    { slug: "derzhateli-i-zaryadki", has: ["зарядк", "usb", "microusb", "iphone", "телефон"] },
    { slug: "vyklyuchateli-i-provodka", has: ["пвс", "пгва", "монтажн", "акустич", "бухт", "проводк", "жгут", "разъем", "электр", "конт"] },
    { slug: null },
  ]],
  [["автопровод", "шлейф"], only("vyklyuchateli-i-provodka")],
  [["кабел"], [
    { slug: "derzhateli-i-zaryadki", has: ["зарядк", "usb", "microusb", "iphone", "телефон", "lightning"] },
    { slug: "avtoelektronika", has: ["hdmi", "aux", "rca", "видео", "аудио", "антенн"] },
    { slug: "provoda-i-klemmy", has: ["пусков", "прикурив", "акб", "аккумулятор"] },
    { slug: "vyklyuchateli-i-provodka" },
  ]],
  // «Втягивающее Г-53 для стартера»: the solenoid, named by its adjective alone.
  [["втягивающ"], only("generatory-i-startery")],
  [["трамблер", "бегунок", "бегунк", "коммутатор"], only("tramblery-i-kommutatory")],
  [["распределител"], [
    { slug: "tramblery-i-kommutatory", has: ["зажиган"] },
    { slug: "tormoznye-tsilindry", has: ["тормоз"] },
    { slug: null },
  ]],

  // ---- Cooling, heating, air conditioning ----
  [["радиатор"], [
    { slug: "radiatory-otopitelya", has: ["печк", "отопител", "салон"] },
    { slug: "konditsioner", has: ["кондиционер"] },
    { slug: "turbiny", has: ["интеркулер", "наддув"] },
    { slug: "sistema-smazki", has: ["маслян", "масла", "акпп"] },
    { slug: "radiatory" },
  ]],
  [["конденсер", "испарител"], only("konditsioner")],
  [["конденсатор"], [
    { slug: "konditsioner", has: ["кондиционер"] },
    { slug: "tramblery-i-kommutatory", has: ["зажиган", "трамблер"] },
    { slug: null },
  ]],
  // All sixteen «осушитель» of the owner's base are truck air driers; an air-conditioner's one says so.
  [["осушител"], [
    { slug: "konditsioner", has: ["кондиционер", "ресивер"] },
    { slug: "pnevmotormoza" },
  ]],
  [["компрессор"], [
    { slug: "konditsioner", has: ["кондиционер"] },
    { slug: "pnevmotormoza", has: ["пневмосистем", "тормоз"] },
    { slug: "kompressory" },
  ]],
  [["кондиционер"], [
    { slug: "dlya-salona", has: ["кож", "пластик", "резин"] },
    { slug: "prisadki", has: ["металл"] },
    { slug: null },
  ]],
  [["термостат"], only("termostaty")],
  [["вентилятор"], [
    { slug: "komfort-v-salone", has: ["салон", "usb", "прикуриват"] },
    { slug: "ventilyatory" },
  ]],
  [["крыльчатк", "диффузор"], only("ventilyatory")],
  [["мотор$", "мотора$", "моторчик", "электродвигател", "электромотор", "моторедуктор"], [
    { slug: "ventilyatory", has: ["отопител", "печк", "вентилятор", "охлажд", "радиатор"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["стеклоочист", "дворник", "омывател", "трапец"] },
    { slug: "elektromotory", has: ["стеклоподъем", "замк", "двер", "зеркал", "люк", "сиден"] },
    { slug: null },
  ]],
  [["бачок", "бачк"], [
    { slug: "avtonomnye-otopiteli", has: ["автономн", "автономк"] },
    { slug: "rasshiritelnye-bachki", has: ["расширит", "охлажд"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател", "стеклоомыв"] },
    { slug: "rulevye-reyki-i-gur", has: ["гур", "гидроусил", "рулев"] },
    { slug: "tormoznye-tsilindry", has: ["тормоз", "главн"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: null },
  ]],

  // ---- Clutch, drive, gearbox ----
  [["сцеплен"], only("stseplenie")],
  [["корзин"], [{ slug: "stseplenie", has: ["сцеплен"] }, { slug: null }]],
  [["вилк"], [
    { slug: "stseplenie", has: ["сцеплен", "выжим"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "переключ"] },
    { slug: "kardannye-valy", has: ["кардан"] },
    { slug: "bagazhniki-i-farkopy", has: ["розетк", "штепсел", "прицеп"] },
    { slug: null },
  ]],
  [["шрус", "гранат", "полуос", "трипоид"], [
    // «Шрус Ярнефть 100 г в тубе»: named after what it is for, sold by weight — the grease.
    { slug: "smazki", has: ["г$", "гр$", "кг$", "туб", "смазк"] },
    { slug: "shrusy-i-privody" },
  ]],
  [["привод$", "привода$", "приводы$"], [
    { slug: "grm", has: ["грм"] },
    { slug: "elektromotory", has: ["замк", "заслон", "центральн", "стеклоподъем"] },
    { slug: "datchiki", has: ["спидометр"] },
    { slug: "omyvateli-i-stekloochistiteli", has: ["стеклоочист"] },
    { slug: null, has: ["вентилятор"] },
    { slug: "shrusy-i-privody" },
  ]],
  [["крестовин"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "krestoviny-i-podshipniki" },
  ]],
  [["кпп$", "мкпп$", "акпп$", "раздатк", "синхронизатор", "кулис", "хвостовик", "дифференциал", "гидротрансформатор", "селектор"], only("kpp-i-reduktory")],
  [["редуктор"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: null, has: ["газов", "гбо", "пропан", "метан"] },
    { slug: "kpp-i-reduktory" },
  ]],
  [["соленоид"], [{ slug: "kpp-i-reduktory", has: ["акпп", "кпп"] }, { slug: null }]],
  [["мост$", "моста$"], [
    { slug: "generatory-i-startery", has: ["диод", "генератор", "выпрямител"] },
    { slug: "kpp-i-reduktory", has: ["задн", "передн", "редуктор"] },
    { slug: null },
  ]],

  // ---- Electrics ----
  [["генератор", "стартер", "бендикс", "щеткодержател", "якор"], only("generatory-i-startery")],
  [["щетк", "щеток"], [
    { slug: "generatory-i-startery", has: ["генератор", "стартер"] },
    { slug: "slesarnyy-instrument", has: ["металл", "корщетк", "зачист", "проволоч"] },
    { slug: "shchetki-i-skrebki", has: ["снег", "сметк", "скребок", "скребк", "льда", "мойк", "мытья"] },
    { slug: null },
  ]],
  [["регулятор"], [
    { slug: "generatory-i-startery", has: ["напряжен", "генератор"] },
    { slug: "toplivnaya-sistema", has: ["топлив"] },
    { slug: "vpusknaya-sistema", has: ["холост"] },
    { slug: "tormoznye-tsilindry", has: ["тормоз"] },
    { slug: "fary-i-fonari", has: ["фар"] },
    { slug: null },
  ]],
  [["реле$"], [
    { slug: "generatory-i-startery", has: ["втягив", "стартер", "генератор", "напряжен", "регулятор"] },
    { slug: "predohraniteli-i-rele" },
  ]],
  [["ротор", "статор"], [{ slug: "generatory-i-startery", has: ["генератор", "стартер"] }, { slug: null }]],
  [["датчик", "лямбд", "расходомер", "дмрв$", "дпдз$", "дпкв$", "термовыключател"], only("datchiki")],
  [["зонд"], [{ slug: "datchiki", has: ["лямбд", "кислород"] }, { slug: null }]],
  [["предохранител"], only("predohraniteli-i-rele")],
  [["выключател", "переключател", "включател", "кнопк", "фишк", "коннектор", "тумблер"], only("vyklyuchateli-i-provodka")],
  // An air coupling is not an electrical connector. «Разьем» is the base's usual misspelling.
  [["разъем", "разьем"], [
    { slug: "bystrosemy", has: ["пневм", "быстросъем", "быстросьем"] },
    { slug: "vyklyuchateli-i-provodka" },
  ]],
  [["жгут"], [
    { slug: "vyklyuchateli-i-provodka", has: ["провод"] },
    // Tyre plugs are sold by size, count and colour: «Жгут В-200-6 мм», «Жгуты (30 шт.) 6мм», «Жгуты черные 200мм».
    { slug: "shinomontazh", has: ["шин", "ремонт", "бескамер", "мм$", "шт$", "черн", "коричнев", "резинов", "армирован", "адгезив"] },
    { slug: "aptechki", has: ["кровоостан", "медицин"] },
    { slug: null },
  ]],
  [["клемм"], [
    { slug: "provoda-i-klemmy", has: ["акб$", "аккумулятор"] },
    { slug: "vyklyuchateli-i-provodka", has: ["обжим", "изолир", "набор", "кольцев", "вилочн", "плоск", "папа", "мама"] },
    { slug: "provoda-i-klemmy" },
  ]],
  [["сигнал$", "сигнала$", "сигналы$", "клаксон", "гудок", "сирен"], [
    { slug: null, has: ["поворот", "аварийн", "стоп"] },
    { slug: "zvukovye-signaly" },
  ]],
  [["блок$", "блока$", "блоки$"], [
    { slug: "fary-i-fonari", has: ["фара", "фары"] },
    { slug: "bloki-upravleniya", has: ["управлен", "эбу", "комфорт", "abs", "абс", "srs", "розжиг"] },
    { slug: "predohraniteli-i-rele", has: ["предохранител", "реле", "монтажн"] },
    { slug: "porshnevaya-i-klapany", has: ["цилиндр"] },
    { slug: null },
  ]],
  [["эбу$", "иммобилайзер"], only("bloki-upravleniya")],
  [["актуатор", "активатор"], only("elektromotory")],
  [["замок$", "замка$", "замки$", "замков$"], [
    { slug: "vyklyuchateli-i-provodka", has: ["зажиган"] },
    { slug: null, has: ["противоугон", "блокир", "велосипед", "навесн"] },
    { slug: "zamki-i-ruchki" },
  ]],
  [["личинк", "стеклоподъемник"], only("zamki-i-ruchki")],
  [["ручк"], [
    { slug: "zamki-i-ruchki", has: ["двер", "стеклоподъем", "багажник", "капот", "открыван", "наружн", "внутрен", "форточк"] },
    { slug: "kpp-i-reduktory", has: ["кпп", "переключ"] },
    { slug: null },
  ]],
  [["петл"], [
    { slug: "zamki-i-ruchki", has: ["двер", "капот", "багажник"] },
    { slug: "zhilety-i-buksirnye-trosy", has: ["буксир"] },
    { slug: null },
  ]],
  [["ограничител"], [{ slug: "zamki-i-ruchki", has: ["двер"] }, { slug: null }]],

  // ---- Lights ----
  [["фара$", "фары$", "фару$", "фар$"], [
    { slug: "dopolnitelnyy-svet", has: ["рабоч", "дополнит", "прожектор", "балк", "искател", "led", "светодиод"] },
    { slug: "fary-i-fonari" },
  ]],
  // «Поворот TOYOTA CORONA 92-94», «Туманка TOYOTA WISH»: the counter's names for a turn signal and a fog lamp.
  [["поворот$", "повороты$", "туманк"], only("fary-i-fonari")],
  [["фонар"], [
    { slug: "fary-i-fonari", has: ["задн", "стоп", "номер", "габарит", "маркерн", "подсвет", "лев", "прав", "противотуман", "поворот", "салон", "автопоезд"] },
    { slug: "fonari", has: ["налобн", "лоб$", "аккумуляторн", "кемпинг", "ручн", "карман", "светодиодн", "переносн", "брелок", "туристич", "магнит", "фонарик"] },
    { slug: null },
  ]],
  [["птф$", "повторител", "поворотник", "катафот", "отражател", "световозвращател", "плафон", "подфарник"], only("fary-i-fonari")],
  [["огни$", "огней$"], [{ slug: "dopolnitelnyy-svet", has: ["ходов", "дневн"] }, { slug: "fary-i-fonari", has: ["габарит"] }, { slug: null }]],
  [["плата$", "платы$"], [{ slug: "fary-i-fonari", has: ["фонар"] }, { slug: null }]],
  // A lamp's socket is wiring, not a lamp.
  [["патрон"], [{ slug: "vyklyuchateli-i-provodka", has: ["ламп"] }, { slug: null }]],
  // A blow lamp and a work light are tools; a bulb is left to the lamp rules.
  [["лампа$", "лампы$", "лампу$", "ламп$"], [
    { slug: "slesarnyy-instrument", has: ["паяльн"] },
    { slug: "fonari", has: ["переносн", "гаражн"] },
    { slug: null },
  ]],
  [["указател"], [
    { slug: "fary-i-fonari", has: ["поворот"] },
    // Dashboard gauges.
    { slug: "datchiki", has: ["температур", "топлив", "давлен", "тока$", "амперметр", "уровн", "масла$", "напряжен", "приборн"] },
    { slug: null },
  ]],
  // «Габарит TOYOTA COROLLA 97-02»: the side light as a body part. Whole words only: «габаритная лампа» is a bulb.
  [["габарит$", "габарита$", "габариты$"], only("fary-i-fonari")],
  // «Номера рамка пластм.», «Номера подсветка»: the shop files number-plate goods under the word «номера».
  [["номер$", "номера$"], [{ slug: "ramki-i-nakleyki", has: ["рамк", "подсветк", "креплен"] }, { slug: null }]],
  [["креплен"], [
    { slug: "ramki-i-nakleyki", has: ["номер"] },
    { slug: "bampery-i-reshetki", has: ["бампер"] },
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп"] },
    { slug: "fary-i-fonari", has: ["фары$", "фар$", "фонар"] },
    { slug: "ressory", has: ["рессор"] },
    { slug: "rychagi", has: ["рычаг"] },
    { slug: null },
  ]],
  [["дхо$", "прожектор", "стробоскоп"], only("dopolnitelnyy-svet")],
  [["балк"], [
    { slug: "dopolnitelnyy-svet", has: ["светодиод", "led"] },
    { slug: "podveska", has: ["задн", "подвеск", "мост"] },
    { slug: null },
  ]],
  [["маяк"], [{ slug: "dopolnitelnyy-svet", has: ["проблеск", "оранж", "сигнальн"] }, { slug: null }]],
  [["светодиод$", "светодиоды$"], only("svetodiodnye-lampy")],
  [["переноск"], only("fonari")],

  // ---- Fuel ----
  [["форсунк"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател", "стеклоомыв", "фар"] },
    { slug: "forsunki" },
  ]],
  [["инжектор", "рампа$", "рампы$"], only("forsunki")],
  [["распылител", "плунжер", "плунжерн", "тнвд$"], [{ slug: null, has: ["помпов", "садов"] }, { slug: "dizelnaya-apparatura" }]],
  [["карбюратор"], only("karbyuratory")],
  [["жиклер"], [
    { slug: "omyvateli-i-stekloochistiteli", has: ["омывател"] },
    { slug: "karbyuratory" },
  ]],
  [["бензобак", "горловин", "адсорбер"], only("toplivoprovody-i-baki")],
  [["бак$", "бака$", "баки$"], [{ slug: "toplivoprovody-i-baki", has: ["топлив", "бензин"] }, { slug: null }]],
  [["сетк"], [
    { slug: "avtonomnye-otopiteli", has: ["свечи$", "гидроник", "eberspacher", "webasto", "отопител", "автономк", "распылител"] },
    { slug: "toplivnye-nasosy", has: ["бензонасос", "топлив"] },
    { slug: "bagazhniki-i-farkopy", has: ["багаж"] },
    { slug: "bampery-i-reshetki", has: ["радиатор", "бампер"] },
    { slug: null },
  ]],
  [["фильтр"], [
    { slug: "filtry-akpp-i-gidravliki", has: ["акпп", "вариатор", "гидравл", "трансмисс", "гур", "cvt"] },
    // «Фильтр-сетка (… насос)»: the strainer of a fuel pump.
    { slug: "toplivnye-filtry", all: ["сетк"], has: ["насос", "бензонасос"] },
    { slug: null },
  ]],

  // ---- Exhaust ----
  [["глушител", "катализатор", "пламегасител"], only("glushiteli")],
  [["резонатор"], [
    { slug: "vpusknaya-sistema", has: ["воздуш", "фильтр"] },
    { slug: "glushiteli" },
  ]],
  [["труба$", "трубы$", "трубу$"], [
    { slug: "gofry-i-krepleniya", has: ["гофр"] },
    { slug: "truby-i-kollektory", has: ["приемн", "глушител", "выхлоп", "выпуск", "промежуточн"] },
    { slug: "patrubki-i-shlangi", has: ["перепускн", "расширительн", "радиатор", "отопител"] },
    { slug: null },
  ]],
  [["металлорукав"], only("gofry-i-krepleniya")],
  [["гофр"], [
    { slug: "vpusknaya-sistema", has: ["воздуш", "воздух", "фильтр"] },
    { slug: "vyklyuchateli-i-provodka", has: ["провод", "электр", "кабел"] },
    { slug: "gofry-i-krepleniya" },
  ]],
  [["насадк"], [{ slug: "glushiteli", has: ["глушител"] }, { slug: null }]],
  [["труба$", "трубы$", "трубу$", "штаны$"], [
    { slug: "truby-i-kollektory", has: ["приемн", "выхлоп", "глушител", "штаны"] },
    { slug: null },
  ]],
  [["хомут"], [
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп"] },
    { slug: "pylniki-shrus", has: ["шрус", "пыльник"] },
    { slug: "styazhki-i-izolenta", has: ["пластик", "нейлон", "стяжк", "кабел"] },
    { slug: "homuty" },
  ]],
  [["кронштейн"], [
    { slug: "gofry-i-krepleniya", has: ["глушител", "выхлоп"] },
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: "bampery-i-reshetki", has: ["бампер"] },
    { slug: "generatory-i-startery", has: ["генератор"] },
    { slug: "opory-dvigatelya", has: ["двигател", "опор"] },
    { slug: "bryzgoviki-i-podkrylki", has: ["брызговик"] },
    { slug: "ramki-i-nakleyki", has: ["номер"] },
    { slug: "ressory", has: ["рессор"] },
    { slug: null },
  ]],
  [["резинк"], [
    { slug: "gofry-i-krepleniya", has: ["глушител"] },
    { slug: "bagazhniki-i-farkopy", has: ["груза$", "багажник", "крюк", "крючк", "карабин"] },
    { slug: "rezinki-shchetok", has: ["стеклоочист", "щетк", "щеток", "дворник"] },
    { slug: "stabilizator", has: ["стабилизатор"] },
    { slug: "stekla-i-uplotniteli", has: ["уплотнит", "двер", "стекл"] },
    { slug: null },
  ]],
  [["подвес$", "подвеса$"], [{ slug: "gofry-i-krepleniya", has: ["глушител"] }, { slug: null }]],

  // ---- Body ----
  [["бампер", "спойлер", "губа$", "губы$"], only("bampery-i-reshetki")],
  [["решетк"], [
    { slug: null, has: ["вентиляц", "динамик", "гриль"] },
    { slug: "bampery-i-reshetki" },
  ]],
  [["накладк"], [
    { slug: "bampery-i-reshetki", has: ["бампер"] },
    { slug: "tormoznye-kolodki", has: ["тормоз", "колод", "фрикцион"] },
    { slug: "stseplenie", has: ["сцеплен"] },
    { slug: "komfort-v-salone", has: ["педал"] },
    { slug: "zamki-i-ruchki", has: ["ручк"] },
    { slug: "moldingi-i-emblemy", has: ["порог", "арк", "крыл", "двер", "кузов"] },
    { slug: null },
  ]],
  [["капот", "крыло$", "крыла$", "крылья$", "дверь$", "двери$", "порог", "арка$", "арки$", "лонжерон", "телевизор"], only("kuzovnye-paneli")],
  [["панел"], [
    { slug: "svetodiodnye-lampy", has: ["светодиодн", "smd$", "диод"] },
    { slug: "kuzovnye-paneli", has: ["кузов", "задн", "передн", "рамк"] },
    { slug: null },
  ]],
  [["рамк"], [
    { slug: "ramki-i-nakleyki", has: ["номер", "защелк"] },
    { slug: "kuzovnye-paneli", has: ["радиатор"] },
    { slug: "avtoelektronika", has: ["магнитол", "переходн"] },
    { slug: null },
  ]],
  [["стекло$", "стекла$", "стекол$"], [
    { slug: "fary-i-fonari", has: ["фар", "фонар", "противотуман", "птф"] },
    { slug: "zerkala", has: ["зеркал"] },
    { slug: "stekla-i-uplotniteli", has: ["лобов", "ветров", "боков", "задн", "двер", "опускн", "форточк"] },
    { slug: null },
  ]],
  [["уплотнител"], [
    { slug: "prokladki-i-salniki", has: ["свеч", "колодц", "форсун", "клапан", "маслян"] },
    { slug: "stekla-i-uplotniteli" },
  ]],
  [["молдинг", "эмблем", "шильдик", "надпис", "буквы$"], only("moldingi-i-emblemy")],
  [["заглушк"], [
    { slug: "moldingi-i-emblemy", has: ["бампер", "порог", "кузов", "крюк", "буксир"] },
    { slug: null },
  ]],
  [["зеркал"], [
    { slug: null, has: ["косметич"] },
    { slug: "zerkala" },
  ]],
  [["элемент"], [
    // «ФГОТ», «ФТОТ»: фильтр грубой / тонкой очистки топлива.
    { slug: "toplivnye-filtry", has: ["фгот$", "фтот$"] },
    // «Фильтрующий элемент …»: a filter; the rest of the name says which.
    { slug: "filtry", has: ["фильтрующ"] },
    // «Формовочный элемент, отбойник рессоры».
    { slug: "ressory", has: ["рессор"] },
    { slug: "zerkala", has: ["зеркал"] },
    { slug: "avtoelektronika", has: ["питан"] },
    { slug: null },
  ]],
  [["брызговик", "подкрылок", "подкрылк", "локер"], only("bryzgoviki-i-podkrylki")],
  [["защит"], [
    { slug: "bryzgoviki-i-podkrylki", has: ["картер", "двигател", "двс", "кпп", "поддон"] },
    { slug: "bampery-i-reshetki", has: ["бампер"] },
    { slug: "vyklyuchateli-i-provodka", has: ["провод"] },
    { slug: null },
  ]],

  // ---- Wheels ----
  [["шина$", "шины$", "шину$", "шин$", "автошин", "покрышк"], [
    { slug: "shinomontazh", has: ["ремкомплект", "бескамер", "ремонт"] },
    { slug: "tsepi-i-shiny-pil", has: ["пильн", "пилы", "бензопил", "цеп"] },
    { slug: "zapchasti-moto", has: [...MOTO, "вело$", "велосипед"] },
    // The owner files tractor and farm tyres with the truck ones («03.05 Спец техника», «03.06 Сельхоз»).
    { slug: "shiny-gruzovye", has: ["грузов", "автотрактор", "трактор", "сельхоз"] },
    { slug: "shiny-legkovye", has: ["легков"] },
    { slug: "shiny-i-diski" },
  ]],
  [["мотошин", "велопокрышк", "мотокамер", "велокамер"], only("zapchasti-moto")],
  [["камер", "автокамер", "флиппер"], [
    { slug: "pnevmotormoza", has: ["тормоз"] },
    { slug: "avtoelektronika", has: ["вида", "видео", "парков", "регистратор"] },
    { slug: "zapchasti-moto", has: [...MOTO, "вело$", "велосипед"] },
    { slug: null, has: ["сгоран"] },
    { slug: "kamery" },
  ]],
  [["лент"], [
    { slug: "kamery", has: ["ободн"] },
    { slug: "rezinki-shchetok", has: ["щетк", "щеток", "стеклоочист"] },
    { slug: "dopolnitelnyy-svet", has: ["светодиод"] },
    { slug: "bagazhniki-i-farkopy", has: ["стяжн", "груз"] },
    { slug: "styazhki-i-izolenta", has: ["изоляц", "фум", "уплотн", "малярн", "клейк", "двусторон", "армирован", "сигнальн"] },
    { slug: null },
  ]],
  [["колпак"], [{ slug: "stupitsy-i-podshipniki", has: ["ступиц"] }, { slug: "kolpaki" }]],
  [["вентиль$", "вентиля$", "вентили$", "вентилей$", "вентель$", "ниппел", "золотник", "грузик", "заплатк", "латк"], only("shinomontazh")],
  [["аптечк"], [
    // «Аптечка ремонта золотников» is a repair kit, not a first-aid kit.
    { slug: "shinomontazh", has: ["шин", "камер", "вело", "бескамер", "ремонт", "золотник"] },
    { slug: null },
  ]],
  [["грибок", "грибк", "гриб$", "шинка$", "шинки$"], only("shinomontazh")],
  [["игла$", "иглы$", "иглу$", "игл$"], [
    { slug: "karbyuratory", has: ["карбюратор"] },
    { slug: "shinomontazh", has: ["жгут", "шин$", "шины$"] },
    { slug: null },
  ]],
  [["шило$", "шила$"], [{ slug: "shinomontazh", has: ["жгут", "шин$", "шины$", "игл"] }, { slug: "slesarnyy-instrument" }]],
  [["эксцентрик"], only("rychagi")],
  // «Крепежный шнур резиновый с крюками»: a luggage strap.
  [["шнур"], [{ slug: "bagazhniki-i-farkopy", has: ["крюк", "карабин", "багаж", "крепежн"] }, { slug: null }]],
  // «Стоп сигнал», «стоп-сигнал».
  [["стоп$"], [{ slug: "fary-i-fonari", has: ["сигнал"] }, { slug: null }]],
  [["пластыр"], [{ slug: "aptechki", has: ["бактерицид", "медицин", "перцов"] }, { slug: "shinomontazh" }]],
  [["секретк"], only("kolesnyy-krepezh")],
  [["футорк"], only("kolesnyy-krepezh")],
  [["гайк", "гаек"], [
    { slug: "kolesnyy-krepezh", has: ["колес", "секрет", "конус", "сфер"] },
    { slug: "stupitsy-i-podshipniki", has: ["ступиц", "шрус"] },
    { slug: "bolty-i-gayki", general: true },
  ]],
  [["болт"], [
    { slug: "kolesnyy-krepezh", has: ["колес", "секрет"] },
    { slug: "rychagi", has: ["развал", "эксцентрик"] },
    // «головка» alone is the bolt's own head («с шестигранной головкой»); the cylinder head is «головка блока / цилиндров».
    { slug: "porshnevaya-i-klapany", has: ["гбц", "шатун"] },
    { slug: "porshnevaya-i-klapany", all: ["головк"], has: ["блок", "цилиндр"] },
    { slug: "bolty-i-gayki", general: true },
  ]],
  [["шпильк"], [
    { slug: "kolesnyy-krepezh", has: ["колес", "ступиц"] },
    { slug: "bolty-i-gayki", general: true },
  ]],
  [["проставк"], [
    { slug: "ramki-i-nakleyki", has: ["рамк", "номер"] },
    { slug: "pruzhiny", has: ["межвитков"] },
    { slug: "kolesnyy-krepezh", has: ["колес", "диск", "ступиц", "лить"] },
    { slug: "opory-i-pylniki", has: ["пружин", "амортизатор", "стойк", "клиренс"] },
    { slug: null },
  ]],

  // ---- Fasteners and consumables ----
  [["винт", "саморез", "шуруп", "заклепк", "шплинт", "гровер", "шпонк", "штифт"], only("bolty-i-gayki")],
  [["клипс", "пистон"], only("klipsy")],
  [["крепеж"], only("krepezh")],
  [["изолент", "термоусадк", "скотч"], only("styazhki-i-izolenta")],
  [["стяжк"], [
    { slug: "bagazhniki-i-farkopy", has: ["груз", "ремен", "храпов", "багаж"] },
    { slug: "garazhnoe-oborudovanie", has: ["пружин"] },
    { slug: "styazhki-i-izolenta" },
  ]],

  // ---- Accessories ----
  [["фаркоп", "тсу$", "багажник", "рейлинг", "автобокс"], only("bagazhniki-i-farkopy")],
  [["шар$", "шара$"], [{ slug: "bagazhniki-i-farkopy", has: ["фаркоп", "тсу", "тягово", "сцепн", "прицеп"] }, { slug: null }]],
  [["розетк"], [
    { slug: "bagazhniki-i-farkopy", has: ["прицеп", "фаркоп"] },
    { slug: "derzhateli-i-zaryadki", has: ["прикуриват"] },
    { slug: null },
  ]],
  [["коврик", "ковр"], [
    { slug: "derzhateli-i-zaryadki", has: ["панел", "торпед", "липк", "противоскольз"] },
    { slug: "kovriki" },
  ]],
  [["чехол", "чехл", "авточехл"], [
    { slug: "pylniki-shrus", has: ["шрус", "привод", "гранат"] },
    { slug: "rulevye-reyki-i-gur", has: ["рейк"] },
    { slug: "kpp-i-reduktory", has: ["кпп$", "кулис", "переключ"] },
    { slug: "avtoelektronika", has: ["брелок", "брелк", "сигнализац"] },
    // A cover of a machine's part («чехол тормозного кожуха МТЗ») is not a seat cover.
    { slug: null, has: ["кожух", "тормоз"] },
    { slug: "chehly" },
  ]],
  // «Майки» are slip-on seat covers.
  [["майк"], [{ slug: "chehly", has: ["велюр", "сиден", "чехл", "предмет"] }, { slug: null }]],
  [["накидк"], [
    { slug: "komfort-v-salone", has: ["подогрев", "массаж"] },
    { slug: "chehly" },
  ]],
  [["оплетк"], only("chehly")],
  [["ароматиз", "освежител"], only("aromatizatory")],
  [["канистр", "воронк"], only("kanistry-i-voronki")],
  [["скребок", "скребк", "сметк", "водосгон", "лопат"], only("shchetki-i-skrebki")],
  [["губк", "салфетк", "тряпк", "ветош", "микрофибр", "микрофибров", "полотенц", "замш"], [{ slug: null, has: ["пола$", "посуд", "кухон"] }, { slug: "dlya-moyki" }]],
  [["органайзер", "подголовник", "термос", "термокружк", "холодильник", "подлокотник", "подогрев"], only("komfort-v-salone")],
  [["дефлектор", "ветровик", "шторк", "мухобойк"], only("deflektory-i-shtorki")],
  [["пленк"], [{ slug: "deflektory-i-shtorki", has: ["тонир", "защитн", "бронир"] }, { slug: null }]],
  [["наклейк"], only("ramki-i-nakleyki")],
  [["знак"], [
    { slug: "ramki-i-nakleyki", has: ["шип", "наклейк", "учебн", "инвалид", "ребенок"] },
    { slug: null },
  ]],
  [["магнитол", "автомагнитол", "видеорегистратор", "регистратор", "радар", "антирадар", "навигатор", "парктроник", "сигнализац", "автосигнализац", "динамик", "сабвуфер", "антенн", "трансмиттер", "модулятор", "батарейк"], only("avtoelektronika")],
  [["колонк"], [
    { slug: "rulevye-mehanizmy", has: ["рулев"] },
    { slug: "avtoelektronika", has: ["акустич", "динамик"] },
    { slug: null },
  ]],
  [["держател"], [
    { slug: "predohraniteli-i-rele", has: ["предохранител"] },
    { slug: "derzhateli-i-zaryadki", has: ["телефон", "смартфон", "планшет", "магнит", "навигатор", "сотов"] },
    { slug: "ramki-i-nakleyki", has: ["номер"] },
    { slug: null },
  ]],
  [["разветвител"], [{ slug: "soediniteli-shlangov", has: ["штуцер", "шланг"] }, { slug: "derzhateli-i-zaryadki" }]],
  [["прикуривател", "инвертор"], only("derzhateli-i-zaryadki")],
  [["кабел"], [
    { slug: "derzhateli-i-zaryadki", has: ["usb", "type", "micro", "lightning", "aux", "зарядк"] },
    { slug: null },
  ]],
  [["устройств"], [
    { slug: "derzhateli-i-zaryadki", has: ["usb", "телефон", "прикуриват", "смартфон"] },
    { slug: "zaryadnye-ustroystva", has: ["зарядн", "пуско"] },
    { slug: "bagazhniki-i-farkopy", has: ["прицеп", "тягово", "сцепн"] },
    { slug: null },
  ]],
  [["преобразовател"], [
    { slug: "dlya-remonta", has: ["ржавчин"] },
    { slug: "derzhateli-i-zaryadki", has: ["напряжен"] },
    { slug: null },
  ]],
  [["автомобилист"], only("nabory-avtomobilista")],

  // ---- Tools ----
  [["ключ"], [
    // «Жидкий ключ» is a penetrating grease.
    { slug: "smazki", has: ["жидк"] },
    { slug: null, has: ["зажиган", "заготовк", "выкидн", "чип"] },
    { slug: "klyuchi-i-golovki" },
  ]],
  [["вороток", "воротк", "шестигранник"], only("klyuchi-i-golovki")],
  // «Трещотка» is the tool; the trade's «трещетка» is the slack adjuster of a truck's drum brake.
  [["трещотк"], [{ slug: "pnevmotormoza", has: ["тормоз"] }, { slug: "klyuchi-i-golovki" }]],
  [["трещетк"], [
    { slug: "klyuchi-i-golovki", has: ["ключ", "зуб", "головк", "бит$", "вороток", "воротк"] },
    { slug: "pnevmotormoza", has: ["тормоз", "bpw", "scania", "volvo", "howo", "stellox", "автомат", "механик", "регулятор", "рычаг"] },
    { slug: null },
  ]],
  [["удлинител"], [
    // «Удлинитель наконечника прямой 100 мм пластик» is the valve extension of a twin wheel, like «удлинитель вентиля».
    { slug: "kompressory", has: ["шланг"] },
    { slug: "shinomontazh", has: ["вентил", "вентел", "наконечник", "накачк", "подкач"] },
    { slug: null, has: ["электр", "розетк", "сетев", "силов", "катушк"] },
    { slug: "klyuchi-i-golovki" },
  ]],
  [["инструмент"], [
    { slug: "nabory-instrumentov", has: ["набор"] },
    { slug: "instrumenty" },
  ]],
  [["отвертк", "бита$", "биты$", "бит$"], only("otvertki-i-bity")],
  [["пассатиж", "плоскогубц", "кусачк", "бокорез", "круглогубц", "клещ", "стриппер"], only("sharnirno-gubtsevyy")],
  [["молот", "кувалд", "зубил", "керн$", "напильник", "надфил", "ножовк", "полотн", "сверл", "метчик", "плашк", "тиск", "струбцин", "стамеск", "экстрактор", "монтировк", "монтажк", "киянк"], only("slesarnyy-instrument")],
  [["шприц"], [
    { slug: null, has: ["медицин"] },
    { slug: "shpritsy-i-maslenki" },
  ]],
  [["масленк", "тавотниц"], only("shpritsy-i-maslenki")],
  [["пресс$"], [{ slug: "shpritsy-i-maslenki", has: ["масленк"] }, { slug: null }]],
  // A hand or geared wheel-nut wrench («мясорубка») is a hand tool.
  [["гайковерт"], [{ slug: "klyuchi-i-golovki", has: ["ручн", "механич", "мясорубк"] }, { slug: "elektroinstrument" }]],
  [["дрел", "шуруповерт", "болгарк", "ушм$", "перфоратор", "лобзик", "паяльник", "пневмогайковерт", "краскопульт"], only("elektroinstrument")],
  [["перчатк", "рукавиц", "краг", "респиратор", "наколенник", "комбинезон"], only("sredstva-zashchity")],
  [["лебедк", "подкат", "лежак"], only("garazhnoe-oborudovanie")],
  [["домкрат", "подставк"], only("domkraty")],
  [["съемник", "оправк"], only("semniki")],
  [["тестер", "мультиметр", "ареометр", "манометр", "компрессометр", "пробник", "штангенциркул", "рулетк", "сканер"], only("diagnostika")],

  // ---- Chemistry and paint ----
  [["краск", "эмаль$", "эмали$", "грунт$", "грунтовк", "шпатлевк", "лак$", "растворител", "разбавител", "антигравий", "антигравийн", "автоэмал", "антисиликон", "керосин", "ацетон", "сольвент", "уайт"], only("kraski-i-gruntovki")],
  [["бумаг", "шкурк"], [{ slug: "kraski-i-gruntovki", has: ["наждач", "шлифовал", "шкурк"] }, { slug: null }]],
  [["маркер"], [{ slug: "kraski-i-gruntovki", has: ["эмалев", "краск", "шин", "универсальн", "перманент"] }, { slug: null }]],
  [["круг$", "круга$", "круги$"], [{ slug: "slesarnyy-instrument", has: ["отрезн", "шлифовал", "зачистн", "лепестк", "алмазн", "наждач", "абразив"] }, { slug: null }]],
  [["пистолет"], [
    { slug: "kompressory", has: ["подкач", "накач", "шин$", "колес"] },
    { slug: "elektroinstrument", has: ["продув", "обдув", "пескоструй", "покрасоч", "пневмат"] },
    { slug: "rashodniki-sadovoy-tehniki", has: ["полив", "распылител"] },
    { slug: "slesarnyy-instrument", has: ["герметик", "пены$", "пена$", "монтажн", "клеев"] },
    { slug: null },
  ]],
  // As the product's own noun «мойка» is a pressure washer («Мойка Huter W105», «Мойка высокого давления»).
  [["мойка$", "мойки$", "мойку$", "минимойк"], only("garazhnoe-oborudovanie")],
  [["сварк"], [{ slug: "dlya-remonta", has: ["холодн"] }, { slug: null }]],
  [["фиксатор"], [
    { slug: "dlya-remonta", has: ["резьб"] },
    { slug: "zamki-i-ruchki", has: ["двер", "капот"] },
    { slug: null },
  ]],
  [["электролит", "мочевин"], only("tehnicheskie-zhidkosti")],
  [["нигрол"], only("transmissionnye-masla")],
  [["масло$", "масла$", "масел$"], [
    { slug: "masla-dlya-moto-i-sadovoy-tekhniki", has: ["двухтакт", "2т", "4т", "бензопил", "цеп", "пильн", "лодочн", ...MOTO] },
    { slug: "promyvochnye-masla", has: ["промывочн"] },
    { slug: "gidravlicheskaya-zhidkost", has: ["компрессор", "индустриал", "веретен"] },
    { slug: null },
  ]],
  [["жидкост"], [
    { slug: "tormoznaya-zhidkost", has: ["тормоз", "dot", "сцеплен"] },
    { slug: "zhidkosti-gur", has: ["гур", "гидроусил"] },
    // «Стартовая жидкость», «жидкость для быстрого старта».
    { slug: "tehnicheskie-zhidkosti", has: ["старт", "запуск"] },
    { slug: "zhidkost-omyvatelya", has: ["омыв", "незамерз", "стеклоом"] },
    { slug: "antifriz", has: ["охлажд"] },
    { slug: "transmissionnye-masla", has: ["акпп", "atf", "cvt", "вариатор"] },
    { slug: null },
  ]],

  // ---- Moto and garden ----
  [["леск", "триммер"], only("rashodniki-sadovoy-tehniki")],
  [["нож$", "ножи$"], [{ slug: "rashodniki-sadovoy-tehniki", has: ["газонокос", "триммер", "кустор"] }, { slug: null }]],
  [["шлем", "мотошлем"], only("zapchasti-moto")],

  // ---- Car chemistry: the product's own noun decides, the words after it only pick the shelf ----
  // («Очиститель карбюратора» is a cleaner, not a part of the fuel system.)
  [["очистител"], [
    { slug: "dlya-kuzova-i-stekol", has: ["стекл", "стекол", "фар$", "фары$", "зеркал", "кузов", "битум", "насеком", "смол", "хром"] },
    { slug: "dlya-salona", has: ["салон", "интерьер", "обивк", "пластик", "кожи$", "кожа$", "велюр", "ткан", "ковр", "панел"] },
    { slug: "dlya-shin-i-diskov", has: ["диск", "шин$", "шины$", "колес"], not: ["тормоз"] },
    { slug: "ochistiteli" },
  ]],
  [["полирол"], [
    { slug: "dlya-kuzova-i-stekol", has: ["кузов", "фар$", "фары$", "стекл", "стекол", "хром", "царапин", "абразив", "воск", "лак", "тефлон", "металлик"] },
    { slug: "dlya-shin-i-diskov", has: ["шин$", "шины$"] },
    // Dashboard, plastic, leather and the «universal» ones.
    { slug: "dlya-salona" },
  ]],
  [["шампун", "автошампун"], only("dlya-moyki")],
  [["пена$", "пены$", "пену$", "пеной$"], [{ slug: "dlya-moyki", has: ["активн", "бесконтак", "мойк"] }, { slug: null }]],
  [["средств"], [{ slug: "dlya-moyki", has: ["бесконтак"] }, { slug: "dlya-salona", has: ["полирующ"] }, { slug: null }]],
  [["промывк", "обезжириват"], only("ochistiteli")],
  [["старт$"], [{ slug: "tehnicheskie-zhidkosti", has: ["быстр"] }, { slug: null }]],
  [["размораживател"], [
    { slug: "dlya-kuzova-i-stekol", has: ["стекол", "стекл"] },
    { slug: "smazki", has: ["замк", "замок"] },
    { slug: "dlya-kuzova-i-stekol" },
  ]],
  [["раскоксовк"], only("ochistiteli")],
  [["мастик"], only("kraski-i-gruntovki")],
  [["паста$", "пасты$"], [
    { slug: "dlya-remonta", has: ["притир", "клапан"] },
    { slug: "ochistiteli", has: ["рук$", "очищающ"] },
    { slug: null },
  ]],
  // Welding: the machine, the rods and the wire are workshop equipment; the mask is protection.
  [["электрод$", "электроды$", "электродов$"], only("garazhnoe-oborudovanie")],
  [["аппарат$", "аппарата$", "проволок"], [{ slug: "garazhnoe-oborudovanie", has: ["сварочн"] }, { slug: null }]],
  [["маск"], [{ slug: "sredstva-zashchity", has: ["сварочн", "защитн", "многоразов", "одноразов", "медицин"] }, { slug: null }]],
  [["ножниц"], [{ slug: "slesarnyy-instrument", has: ["металл"] }, { slug: null }]],
  [["машина$", "машинк"], [{ slug: "elektroinstrument", has: ["шлифовальн", "углошлифов", "полировальн", "ушм$"] }, { slug: null }]],
  [["зажим"], [{ slug: "provoda-i-klemmy", has: ["провод", "крокодил", "акб$", "аккумулятор"] }, { slug: null }]],
  [["адаптер"], [
    { slug: "derzhateli-i-zaryadki", has: ["usb", "type", "автомобильн", "carcharger", "прикуриват", "зарядн"] },
    { slug: "fitingi-metallicheskie", has: ["переходник", "резьб"] },
    { slug: null },
  ]],
  [["пластин"], [{ slug: "dizelnaya-apparatura", has: ["тнвд"] }, { slug: null }]],
  [["пылесос"], [
    { slug: "elektroinstrument", has: ["строительн", "промышлен"] },
    { slug: "avtoelektronika", has: ["автомобильн", "прикуриват"] },
    { slug: null },
  ]],
  // «Таблица … наклейка призма»: the reflective sign plate of a lorry.
  [["таблиц"], [{ slug: "ramki-i-nakleyki", has: ["наклейк", "светоотраж", "призм"] }, { slug: null }]],
  // «Набор для …», «Комплект для …», «Ср-во для …»: the name's own noun says nothing; what the thing is for names
  // its shelf. Reached only when «для» is the first word the name can be read by (findHead).
  [["для$"], [
    { slug: "dlya-kuzova-i-stekol", has: ["стекол", "стекл", "зеркал"] },
    { slug: "dlya-salona", has: ["пластик", "салон"] },
    { slug: "kompressory", has: ["продув"] },
    { slug: "slesarnyy-instrument", has: ["развальцовк"] },
    { slug: "semniki", has: ["установк", "разъединен", "запрессовк", "выпрессовк"] },
    { slug: "rashodniki-sadovoy-tehniki", has: ["полив"] },
    { slug: "derzhateli-i-zaryadki", has: ["зарядк"] },
    { slug: "masla-dlya-variatora", has: ["вариатор"] },
    { slug: null },
  ]],
  // Balance weights for truck wheels: «Груз грузовой 50гр 20шт».
  [["груз$", "груза$"], [{ slug: "shinomontazh", has: ["гр$", "грузов", "балансир", "набивн", "самокле"] }, { slug: null }]],
  // «Быстрый запуск двигателя … аэрозоль»: starting fluid named without the word «жидкость».
  [["запуск"], [{ slug: "tehnicheskie-zhidkosti", has: ["быстр", "аэрозол"] }, { slug: null }]],
  // «Стеклоочиститель 200мл», «… триггер, 500мл»: a glass cleaner. Wiper blades are «щётка стеклоочистителя».
  [["стеклоочистител"], [{ slug: "dlya-kuzova-i-stekol", has: ["мл$", "аэрозол", "триггер", "спрей"] }, { slug: null }]],
  // A fuel heater is diesel equipment; every other «подогреватель» of the base heats the engine before a start.
  [["подогревател"], [
    { slug: "dizelnaya-apparatura", has: ["топлив"] },
    { slug: "komfort-v-salone", has: ["сиден"] },
    { slug: "podogrevateli-dvigatelya" },
  ]],
  [["набивк"], only("prokladki-i-salniki")],
  [["барашек", "барашк"], [{ slug: "kompressory", has: ["подкач", "накач"] }, { slug: null }]],
  [["компонент"], [{ slug: "gofry-i-krepleniya", has: ["выхлоп"] }, { slug: null }]],
  // «Бензин "Галоша" (растворитель)» is a solvent; any other «бензин» in a name is what an oil is for.
  [["бензин$"], [{ slug: "kraski-i-gruntovki", has: ["растворител", "галош", "нефрас"] }, { slug: null }]],
  // «Присадка в моторное масло» is an additive, not an oil; «комплекс суперприсадок к маслу» too.
  [["присадк", "суперприсадк"], only("prisadki")],

  // ---- Known words this module leaves to the section rules ----
  [["антифриз", "тосол", "лампочк", "автоламп", "аккумулятор", "акб$", "дворник", "омывател",
    "огнетушител", "жилет", "смазк", "герметик", "клей$", "клея$", "вода$", "воды$"], only(null)],
];

/** Position, side and packaging words that stand before the part's own noun. */
const LEADING_WORDS: readonly string[] = [
  "передн", "задн", "лев", "прав", "верхн", "нижн", "наружн", "внутрен", "боков",
  "комплект", "компл", "набор", "ремкомплект", "ремкомпл", "пара$", "новый", "новая", "новое", "оригинал", "усилен",
  // Marks the staff put in front of a name in 1С: «В РОЗЛИВ Масло…», «АКЦИЯ Подшипник…», «ШТУЧНО саморезов…».
  "розлив", "разлив", "штучно", "акция$", "распродаж", "уценк", "новинк", "применяемост", "фасовк",
  // Car makes written in Russian in front of the part: «Тойота амортизатор …».
  "тойота", "ниссан", "хонда", "мазда", "митсубиси", "мицубиси", "субару", "сузуки", "исузу", "лексус", "хендай", "хундай", "киа$",
  "ваз$", "лада$", "газ$", "газель", "уаз$", "камаз", "маз$", "зил$", "урал$",
];

/**
 * 1С shorthand → the word it stands for. Applied to the folded name before it is split into words.
 * The dot is optional only for short forms that cannot be mistaken for a word («торм», «топл», «ступ»);
 * «шар», «мин», «зад» stay words unless the dot follows. A short form that ends with its dot may have the next
 * word glued to it («синт.мотор.масло», «торм.колодки»).
 */
const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = ([
  [String.raw`к[-/]т|кт\.|компл\.|к-кт`, "комплект"],
  [String.raw`р[-/]к|рем[./]к[-/]?т?|ремк-т|ремкомпл\.|р\.к\.`, "ремкомплект"],
  [String.raw`с[-/]б(?:лок)?|сайл\.|сайлентбл\.`, "сайлентблок"],
  [String.raw`аморт(?:из)?\.?`, "амортизатор"],
  [String.raw`подш(?:ип)?\.?`, "подшипник"],
  [String.raw`выжим\.?`, "выжимной"],
  [String.raw`наконеч\.?|након\.`, "наконечник"],
  // «Тормоз колодка», «Тормозн колодки», «Тормоз камера»: the owner's groups write the adjective short.
  [String.raw`тормозн?(?=\s+(?:колод|наклад|тре[щш]|камер|диск|барабан|суппорт|шланг|цилиндр))`, "тормозной"],
  [String.raw`мет/рукав`, "металлорукав"],
  [String.raw`ремкомоплект`, "ремкомплект"],
  [String.raw`прокл\.`, "прокладка"],
  [String.raw`стаб(?:ил\.|\.?)`, "стабилизатора"],
  [String.raw`ш/о|шар\.\s*оп\.`, "шаровая опора"],
  [String.raw`шар\.`, "шаровая"],
  [String.raw`торм\.?`, "тормозной"],
  // Not rolls: «Бумажные полотенца 2 рул».
  [String.raw`(?<!\d\s?)рул(?:ев)?\.?`, "рулевой"],
  [String.raw`пер(?:ед)?\.`, "передний"],
  [String.raw`зад\.`, "задний"],
  [String.raw`лев\.`, "левый"],
  [String.raw`прав\.`, "правый"],
  [String.raw`нар(?:уж)?\.`, "наружный"],
  [String.raw`внутр\.`, "внутренний"],
  [String.raw`в/в`, "высоковольтные"],
  // «5-ти ступ», «4-х ступ.», «5-ступ» count a gearbox's speeds; elsewhere «ступ.» is the hub.
  [String.raw`(?<!\d-?(?:ти|х)?[\s-]?)ступ\.?`, "ступицы"],
  [String.raw`генер\.`, "генератора"],
  [String.raw`ст[-/]оч\.?|стеклооч\.`, "стеклоочистителя"],
  [String.raw`масл\.?`, "масляный"],
  [String.raw`возд(?:уш)?\.?`, "воздушный"],
  [String.raw`топл\.?`, "топливный"],
  [String.raw`сал\.`, "салонный"],
  // «п/синт.» before «синт.»: the table is applied in order, and «синт.» would otherwise match inside it.
  [String.raw`п[/.\\-]?синт[а-я]*\.?|п/син|п/с`, "полусинтетическое"],
  // «Рк шин», «РК карбюратор»: «р/к» typed without the slash. Only at the very start of a name — in the middle
  // «РК» is the transfer case («Муфта РК включения переднего моста»).
  [String.raw`(?<=^(?:[^a-zа-я0-9(]*\([^)]*\))?[^a-zа-я0-9]*)рк(?=\s+[а-я])`, "ремкомплект"],
  [String.raw`упл\.`, "уплотнительное"],
  [String.raw`рем\.\s*комплект`, "ремкомплект"],
  [String.raw`вых\.\s*коллект\.?`, "выхлопной коллектор"],
  [String.raw`гидроус\.`, "гидроусилителя"],
  // «р/к диск.тормоза»: the kit of a disc brake, not a brake disc.
  [String.raw`диск\.(?=\s*тормоз)`, "дискового"],
  [String.raw`п/оси`, "полуоси"],
  [String.raw`предохр\.`, "предохранитель"],
  // «Чехол на брелок сигн.» is the key fob of an alarm; elsewhere «сигн.» is the horn.
  [String.raw`(?<=брелок\s)сигн\.`, "сигнализации"],
  [String.raw`сигн\.`, "сигнал"],
  [String.raw`синт\.?`, "синтетическое"],
  // Not minutes: «30 л./мин.», «60 мин.», «10-мин.». A viscosity before it («15W-40 мин.») is not a count.
  [String.raw`(?<![/-])(?<!(?:^|[^a-zа-я0-9-])\d+\s?)мин(?:ер)?\.`, "минеральное"],
  [String.raw`трансм\.?|транс\.`, "трансмиссионное"],
  [String.raw`жидк\.`, "жидкость"],
  [String.raw`акк(?:ум)?\.`, "аккумулятор"],
  [String.raw`аром(?:ат)?-р`, "ароматизатор"],
  [String.raw`нажд\.`, "наждачная"],
] as const).map(([pattern, word]) => [new RegExp(String.raw`(?<![a-zа-я0-9])(?:${pattern})(?:(?<=\.)|(?![a-zа-я0-9]))`, "gu"), ` ${word} `] as const);
/** «д/снега», «д/стёкол»: the slash is glued to the next word. */
const FOR_SHORTHAND = /(?<![a-zа-я0-9])д\/(?=[a-zа-я])/gu;
/** «Ф/маслянный», «Ф/воздушный»: «фильтр» in the owner's group names. Only before a filter's kind: «ф/погрузчик» is a loader. */
const FILTER_SHORTHAND = /(?<![a-zа-я0-9])ф\/(?=масл|возд|салон|топл)/gu;

/** A part number typed without a space before the name: «15330-21011Клапан», «LA-133Фильтр». */
const NUMBER_GLUED_TO_WORD = /(\d)([а-я]{5,})/gu;

function fold(value: string): string {
  return repairMixedScript(value.normalize("NFKC")).toLowerCase().replace(/ё/gu, "е");
}

/**
 * Spells out 1С shorthand in a product or group name («Аморт. пер. лев.» → «амортизатор передний левый») and parts
 * a number from the word glued to it. The section rules read names through this function as well.
 */
export function expandAbbreviations(name: string): string {
  let text = fold(name).replace(NUMBER_GLUED_TO_WORD, "$1 $2").replace(FOR_SHORTHAND, "для ").replace(FILTER_SHORTHAND, "фильтр ");
  for (const [pattern, word] of ABBREVIATIONS) text = text.replace(pattern, word);
  return text.replace(/\s+/gu, " ").trim();
}

/** A weight or volume glued to its number («160гр», «4л») is two words: the unit says what kind of product it is. */
const GLUED_UNIT = /(\d)(гр?|кг|мл|л)(?![a-zа-я0-9])/gu;

/** A note in brackets at the very start («(Рефрежиратор) насос топливный», «(15) В РОЗЛИВ Масло») is not the product's name. */
const LEADING_NOTE = /^[^a-zа-я0-9(]*\([^)]*\)/u;

/** Labels typed into a name with their value: «Бренд: NOK», «Страна: КИТАЙ», «артикул: ST-20-426R». */
const NAME_LABELS = /(?<![a-zа-я0-9])(?:бренд|страна|артикул)\s*:\s*[^\s,;]+[,;]?/gu;
/**
 * «ЗАМЕНА НА DG11322-01», «Заменен на AVX13X1145», «замена ZA-54KWH02D», «Замена снятому LAC-511», «ЗАМЕНА ДЛЯ
 * 42101»: a note about another part number. What follows must carry a digit: «замена подшипника» is work.
 */
const REPLACED_BY_NOTE = /(?<![a-zа-я0-9])замен[а-я]*\s+(?:(?:на|для|снятому)\s+)?(?=\S*\d)\S+/gu;

/** «Снят с производства», «Снят, замена GH21220T»: the staff's note that the part is discontinued. */
const DISCONTINUED_NOTE = /(?<![a-zа-я0-9])снят[аоы]?(?:\s+с\s+производства)?(?![a-zа-я0-9])/gu;

function tokens(name: string): string[] {
  return expandAbbreviations(name)
    .replace(LEADING_NOTE, " ").replace(NAME_LABELS, " ").replace(REPLACED_BY_NOTE, " ").replace(DISCONTINUED_NOTE, " ")
    .replace(GLUED_UNIT, "$1 $2")
    .split(/[^a-zа-я0-9]+/u).filter(Boolean);
}

/** Words that say the name describes work, not a product: «…замена диска сцепления снятие/установка». */
const SERVICE_WORDS: readonly string[] = ["замена", "снятие", "отогрев"];

/**
 * True when a name describes work («Стартер снятие/установка», «Генератор 24V ремонт замена подшипника»): the
 * base keeps the workshop's price list among the parts. A note about a replacement number («ЗАМЕНА НА DG11322-01»)
 * is not work: it is removed before the words are read.
 */
export function describesWork(name: string): boolean {
  const all = tokens(name);
  return SERVICE_WORDS.some((word) => all.includes(word));
}

function starts(token: string, stem: string): boolean {
  if (stem.endsWith("$")) return token === stem.slice(0, -1);
  if (token.startsWith(stem)) return true;
  // The genitive plural of a stem in -к grows a vowel: «прокладок», «крышек», «стоек», «шпилек».
  if (!stem.endsWith("к")) return false;
  const base = stem.slice(0, -1);
  if (base.endsWith("й") || base.endsWith("ь")) return token === `${base.slice(0, -1)}ек`;
  return token === `${base}ок` || token === `${base}ек`;
}

/** The entry whose stem matches the word; the longest stem wins («бензонасос» before «бензо…»). */
function entryFor(token: string): Entry | null {
  let best: Entry | null = null;
  let length = 0;
  for (const entry of ENTRIES) {
    for (const stem of entry[0]) {
      const size = stem.endsWith("$") ? stem.length - 1 : stem.length;
      if (size > length && starts(token, stem)) {
        best = entry;
        length = size;
      }
    }
  }
  return best;
}

const ADJECTIVE_ENDINGS = ["ый", "ий", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ого", "его", "ому", "ему", "ым", "им", "ых", "их", "ую", "юю"];
const NOUN_ENDINGS = ["ение", "ание", "яние", "тие", "ство", "ствие"];

function looksLikeAdjective(token: string): boolean {
  return token.length >= 5 && !NOUN_ENDINGS.some((ending) => token.endsWith(ending)) && ADJECTIVE_ENDINGS.some((ending) => token.endsWith(ending));
}

/** True when one of the entry's stems is this very word: what is left after the stem is an ending, or one letter at most. */
function isOwnWord(entry: Entry, token: string): boolean {
  return entry[0].some((stem) => {
    if (stem.endsWith("$")) return token === stem.slice(0, -1);
    if (!token.startsWith(stem)) return false;
    const rest = token.slice(stem.length);
    return rest.length <= 1 || ADJECTIVE_ENDINGS.includes(rest);
  });
}

const MAX_WORDS_BEFORE_HEAD = 4;

interface Head { entry: Entry | null; token: string }

/**
 * A kit is about the thing it is for: «ремкомплект для установки колодок» is a kit of the pads, «комплект для
 * замены цепи ГРМ» a chain kit, «набор для ремонта шин» a tyre repair kit. After «ремкомплект» the words «для»,
 * «установки», «ремонта», «замены» only lead on; after «набор» / «комплект» only «(для) ремонта» and «(для)
 * замены» do — «набор для установки подшипников» is a tool, and stays unread.
 */
const REPAIR_KIT_PURPOSE: readonly string[] = ["для$", "установк", "ремонт", "монтаж", "замен"];
const SET_PURPOSE: readonly string[] = ["ремонт", "замен"];

function isWord(token: string | undefined): token is string {
  return token !== undefined && /^[а-я]{3,}$/u.test(token);
}

/** The head noun of a name: skips shorthand, position words and adjectives; stops at the first noun. */
function findHead(all: readonly string[]): Head | null {
  let seen = 0;
  let firstSkipped: string | null = null;
  let kit: "repair" | "set" | null = null;
  const words = all.filter(isWord);
  for (const [index, token] of words.entries()) {
    if (kit === "repair" && REPAIR_KIT_PURPOSE.some((word) => starts(token, word))) continue;
    if (kit === "set") {
      const purpose = (word: string | undefined) => word !== undefined && SET_PURPOSE.some((stem) => starts(word, stem));
      if (purpose(token) || (token === "для" && purpose(words[index + 1]))) continue;
    }
    if (starts(token, "ремкомпл")) kit = "repair";
    else if (kit === null && (starts(token, "набор") || starts(token, "комплект"))) kit = "set";
    const leading = LEADING_WORDS.some((word) => starts(token, word));
    const found = leading ? null : entryFor(token);
    // An adjective made from a part's noun is not that part: «уплотнительное кольцо» is a ring, «барабанные
    // колодки» are pads. It keeps the entry only when the entry's stem is the adjective itself («шаровая»).
    const entry = found && looksLikeAdjective(token) && !isOwnWord(found, token) ? null : found;
    if (entry) return { entry, token };
    if (leading || looksLikeAdjective(token)) {
      firstSkipped ??= token;
      seen += 1;
      if (seen >= MAX_WORDS_BEFORE_HEAD) break;
      continue;
    }
    return { entry: null, token };
  }
  return firstSkipped ? { entry: null, token: firstSkipped } : null;
}

/** The noun a part name is about («Передний левый амортизатор» → «амортизатор»), or null when it has no Russian word. */
export function partHeadNoun(name: string): string | null {
  return findHead(tokens(name))?.token ?? null;
}

/** The section or subsection the shop's part dictionary names for a product name, or null. */
/**
 * Soviet motorcycles and mopeds the shop sells parts for. A name that starts with the make is a part for it,
 * whatever the part is: «Юпитер палец поршневой», «ИЖ цепь приводная», «ВОСХОД ТРОС СЦЕПЛЕНИЯ».
 */
const MOTO_MAKES: ReadonlySet<string> = new Set(["иж", "юпитер", "планета", "муравей", "восход", "минск", "урал", "мопед"]);

/** «Урал реле регулятор» is the motorcycle; «Урал-4320 амортизатор» carries a model number and is the truck. */
function leadsWithMotoMake(all: readonly string[]): boolean {
  const first = all.findIndex((token) => /^[а-я]/u.test(token));
  return first !== -1 && MOTO_MAKES.has(all[first]!) && !/^\d/u.test(all[first + 1] ?? "");
}

/** The dictionary's answer: the shelf, and whether it is only the general shelf of a universal part (Meaning.general). */
export interface PartAnswer {
  general: boolean;
  slug: string;
}

export function partDictionaryAnswer(name: string): PartAnswer | null {
  if (describesWork(name)) return null;
  const all = tokens(name);
  if (leadsWithMotoMake(all)) return { general: false, slug: "zapchasti-moto" };
  const head = findHead(all);
  if (!head?.entry) return null;
  const has = (stem: string) => all.some((token) => starts(token, stem));
  const present = (stems: readonly string[]) => stems.some(has);
  for (const meaning of head.entry[1]) {
    if (meaning.all && !meaning.all.every(has)) continue;
    if (meaning.has && !present(meaning.has)) continue;
    if (meaning.not && present(meaning.not)) continue;
    return meaning.slug === null ? null : { general: meaning.general === true, slug: meaning.slug };
  }
  return null;
}

/** The shelf the dictionary gives the name, or null when it does not know the name's noun. */
export function partDictionaryMatch(name: string): string | null {
  return partDictionaryAnswer(name)?.slug ?? null;
}

/** Every slug the dictionary can answer with: checked against the storefront tree in the tests. */
export function partDictionarySlugs(): string[] {
  return [...new Set(ENTRIES.flatMap((entry) => entry[1].flatMap((meaning) => meaning.slug ? [meaning.slug] : [])))];
}

/** Words of a 1С group's name that name a whole section («Ходовая часть» → Подвеска). */
const GROUP_SECTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["podveska", ["подвеск", "ходов"]],
  ["rulevoe-upravlenie", ["рулев"]],
  ["zazhiganie", ["зажиган"]],
  ["ohlazhdenie", ["охлажден", "отоплен"]],
  ["transmissiya", ["трансмисси", "сцеплен", "привод"]],
  ["elektrika", ["электрик", "электрооборуд", "электрич"]],
  ["toplivnaya-sistema", ["топливн"]],
  ["vyhlopnaya-sistema", ["выхлоп", "выпуск"]],
  ["kuzov-i-optika", ["кузов", "оптик"]],
  ["krepezh", ["крепеж", "метиз"]],
  ["aksessuary", ["аксессуар"]],
  ["dvigatel", ["двигател", "двс"]],
  ["shiny-i-diski", ["шины", "шин", "колес", "резина"]],
  ["moto-i-sadovaya-tehnika", ["мото", "вело", "садов", "бензопил"]],
  ["avtohimiya", ["автокосметик", "химия", "автохим"]],
  ["shlangi-i-fitingi", ["шланг", "фитинг", "рвд"]],
];

/** A section named by a 1С group («Детали подвески», «Шины и диски»), or null. */
export function partSectionFromGroupName(name: string): string | null {
  const all = tokens(name);
  // «Топливные фильтры», «Масло для двигателя» are sections of their own.
  if (all.some((token) => token.startsWith("фильтр") || token.startsWith("масл") || token.startsWith("масел"))) return null;
  const hits = GROUP_SECTIONS.filter(([, stems]) => stems.some((stem) => all.some((token) => token.startsWith(stem))));
  if (hits.length === 1) return hits[0]![0];
  if (all.length !== 1) return null;
  // A group called just «Диски» holds wheels (brake discs are named in full); one called just «Стекло» holds glass.
  if (all[0]!.startsWith("диск")) return "kolesnye-diski";
  return all[0]!.startsWith("стекл") ? "stekla-i-uplotniteli" : null;
}
