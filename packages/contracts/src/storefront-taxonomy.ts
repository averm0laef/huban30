/**
 * The storefront's own section tree: the sections the shop has always had
 * (same slugs and URLs), the parts sections for the full 1С assortment, and
 * the subsections inside each. It is the shop's own classification, written
 * by hand — not taken from any parts catalogue. The order here is the order
 * of the catalogue menu.
 * One source for the web (tiles, menus, images) and the API (seeding the
 * categories and sorting imported 1С products into them).
 *
 * `stems` are lower-case, ё→е word starts matched against a product name's
 * tokens once its section is known; sections with empty stems are sorted by
 * the part dictionary instead (apps/api catalog-part-dictionary.ts). `image`
 * is the file under apps/web/public/categories/ (without extension); a
 * subsection without its own picture shows the section's, a section without
 * one is drawn without a picture.
 */
export interface StorefrontSubsection {
  readonly image?: string;
  readonly label: string;
  readonly slug: string;
  readonly stems: readonly string[];
}

export interface StorefrontSection {
  readonly children: readonly StorefrontSubsection[];
  readonly image?: string;
  readonly label: string;
  readonly slug: string;
}

export const STOREFRONT_TAXONOMY: readonly StorefrontSection[] = [
  {
    slug: "motornye-masla", label: "Моторные масла", image: "motornye-masla", children: [
      { slug: "sinteticheskie-motornye-masla", label: "Синтетические", stems: ["синтетич", "синтетик", "synth"], image: "sinteticheskie-motornye-masla" },
      { slug: "polusinteticheskie-motornye-masla", label: "Полусинтетические", stems: ["полусинт", "semi"], image: "polusinteticheskie-motornye-masla" },
      { slug: "mineralnye-motornye-masla", label: "Минеральные", stems: ["минерал", "mineral"], image: "mineralnye-motornye-masla" },
      { slug: "masla-dlya-moto-i-sadovoy-tekhniki", label: "Для мото- и садовой техники", stems: ["2т", "4т", "2t", "4t", "двухтактн", "четырехтактн", "outboard", "мото", "scooter", "скутер", "садов", "лодочн"], image: "masla-dlya-moto-i-sadovoy-tekhniki" },
      { slug: "promyvochnye-masla", label: "Промывочные", stems: ["промывочн"], image: "promyvochnye-masla" },
    ],
  },
  {
    slug: "transmissionnye-masla", label: "Трансмиссионные масла", image: "transmissionnye-masla", children: [
      { slug: "masla-dlya-mkpp", label: "Для МКПП и мостов", stems: ["мкпп", "gl-4", "gl-5", "75w", "80w", "85w"], image: "masla-dlya-mkpp" },
      { slug: "masla-dlya-akpp", label: "Для АКПП (ATF)", stems: ["акпп", "atf", "dexron"], image: "masla-dlya-akpp" },
      { slug: "masla-dlya-variatora", label: "Для вариатора (CVT)", stems: ["вариатор", "cvt"], image: "masla-dlya-variatora" },
    ],
  },
  {
    slug: "antifriz", label: "Антифриз", image: "antifriz", children: [
      { slug: "antifriz-gotovyy", label: "Готовый к применению", stems: ["готов", "-40", "-35"], image: "antifriz-gotovyy" },
      { slug: "antifriz-kontsentrat", label: "Концентраты", stems: ["концентрат"], image: "antifriz-kontsentrat" },
      { slug: "distillirovannaya-voda", label: "Дистиллированная вода", stems: ["дистилл"], image: "distillirovannaya-voda" },
    ],
  },
  {
    slug: "gidravlicheskaya-zhidkost", label: "Гидравлическая жидкость", image: "gidravlicheskaya-zhidkost", children: [
      { slug: "zhidkosti-gur", label: "Для ГУР", stems: ["гур", "усилител", "гидроусил", "psf"], image: "zhidkosti-gur" },
      { slug: "gidravlicheskie-masla", label: "Гидравлические масла", stems: ["гидравл", "hlp"], image: "gidravlicheskaya-zhidkost" },
    ],
  },
  {
    slug: "filtry", label: "Фильтры", image: "filtry", children: [
      { slug: "maslyanye-filtry", label: "Масляные", stems: ["маслян", "масла"], image: "maslyanye-filtry" },
      { slug: "vozdushnye-filtry", label: "Воздушные", stems: ["воздушн"], image: "vozdushnye-filtry" },
      { slug: "salonnye-filtry", label: "Салонные", stems: ["салон"], image: "salonnye-filtry" },
      { slug: "toplivnye-filtry", label: "Топливные", stems: ["топлив"], image: "toplivnye-filtry" },
      { slug: "filtry-akpp-i-gidravliki", label: "Для АКПП и гидравлики", stems: ["акпп", "вариатор", "гидравл", "трансмисс"], image: "filtry-akpp-i-gidravliki" },
    ],
  },
  {
    slug: "tormoznaya-sistema", label: "Тормозная система", image: "tormoznaya-sistema", children: [
      { slug: "tormoznye-kolodki", label: "Тормозные колодки", stems: ["колодк", "колодок"], image: "tormoznye-kolodki" },
      { slug: "tormoznye-diski", label: "Тормозные диски", stems: ["диск"], image: "tormoznye-diski" },
      { slug: "tormoznye-barabany", label: "Тормозные барабаны", stems: ["барабан"], image: "tormoznye-barabany" },
      { slug: "tormoznaya-zhidkost", label: "Тормозная жидкость", stems: ["dot", "жидкост"], image: "tormoznaya-zhidkost" },
      { slug: "supporty-i-remkomplekty", label: "Суппорты и ремкомплекты", stems: ["суппорт", "ремкомплект", "направляющ", "пыльник"], image: "supporty-i-remkomplekty" },
      { slug: "tormoznye-tsilindry", label: "Цилиндры и усилители", stems: ["цилиндр", "усилител", "вакуумн"], image: "tormoznye-tsilindry" },
      { slug: "tormoznye-shlangi", label: "Шланги и трубки", stems: ["шланг", "трубк"], image: "tormoznye-shlangi" },
      { slug: "trosy-ruchnika", label: "Тросы ручного тормоза", stems: ["трос", "ручник", "стояноч"], image: "trosy-ruchnika" },
      { slug: "pnevmotormoza", label: "Пневматика тормозов", stems: ["энергоаккум", "пневм", "камер"], image: "pnevmotormoza" },
    ],
  },
  {
    slug: "podveska", label: "Подвеска", image: "podveska", children: [
      { slug: "amortizatory", label: "Амортизаторы и стойки", stems: [], image: "amortizatory" },
      { slug: "pruzhiny", label: "Пружины", stems: [], image: "pruzhiny" },
      { slug: "rychagi", label: "Рычаги и тяги", stems: [], image: "rychagi" },
      { slug: "sharovye-opory", label: "Шаровые опоры", stems: [], image: "sharovye-opory" },
      { slug: "saylentbloki", label: "Сайлентблоки и втулки", stems: [], image: "saylentbloki" },
      { slug: "stabilizator", label: "Стойки и втулки стабилизатора", stems: [], image: "stabilizator" },
      { slug: "stupitsy-i-podshipniki", label: "Ступицы и подшипники", stems: [], image: "stupitsy-i-podshipniki" },
      { slug: "opory-i-pylniki", label: "Опоры, пыльники, отбойники", stems: [], image: "opory-i-pylniki" },
      { slug: "ressory", label: "Рессоры и стремянки", stems: [], image: "ressory" },
      { slug: "povorotnye-kulaki", label: "Кулаки и шкворни", stems: [], image: "povorotnye-kulaki" },
    ],
  },
  {
    slug: "rulevoe-upravlenie", label: "Рулевое управление", image: "rulevoe-upravlenie", children: [
      { slug: "rulevye-nakonechniki", label: "Рулевые наконечники", stems: [], image: "rulevye-nakonechniki" },
      { slug: "rulevye-tyagi", label: "Рулевые тяги", stems: [], image: "rulevye-tyagi" },
      { slug: "rulevye-reyki-i-gur", label: "Рейки и насосы ГУР", stems: [], image: "rulevye-reyki-i-gur" },
      { slug: "rulevye-mehanizmy", label: "Маятники, сошки и валы", stems: [], image: "rulevye-mehanizmy" },
    ],
  },
  {
    slug: "dvigatel", label: "Двигатель", image: "dvigatel", children: [
      { slug: "remni", label: "Ремни", stems: [], image: "remni" },
      { slug: "roliki-i-natyazhiteli", label: "Ролики и натяжители", stems: [], image: "roliki-i-natyazhiteli" },
      { slug: "grm", label: "Комплекты и цепи ГРМ", stems: [], image: "grm" },
      { slug: "prokladki-i-salniki", label: "Прокладки и сальники", stems: [], image: "prokladki-i-salniki" },
      { slug: "opory-dvigatelya", label: "Опоры двигателя", stems: [], image: "opory-dvigatelya" },
      { slug: "porshnevaya-i-klapany", label: "Поршневая, ГБЦ и клапаны", stems: [], image: "porshnevaya-i-klapany" },
      { slug: "sistema-smazki", label: "Система смазки", stems: [], image: "sistema-smazki" },
      { slug: "turbiny", label: "Турбины и интеркулеры", stems: [], image: "turbiny" },
      { slug: "vpusknaya-sistema", label: "Впуск и дроссель", stems: [], image: "vpusknaya-sistema" },
      { slug: "shkivy-i-mahoviki", label: "Шкивы и маховики", stems: [], image: "shkivy-i-mahoviki" },
    ],
  },
  {
    slug: "zazhiganie", label: "Система зажигания", image: "zazhiganie", children: [
      { slug: "svechi-zazhiganiya", label: "Свечи зажигания", stems: [], image: "svechi-zazhiganiya" },
      { slug: "svechi-nakala", label: "Свечи накаливания", stems: [], image: "svechi-nakala" },
      { slug: "katushki-zazhiganiya", label: "Катушки зажигания", stems: [], image: "katushki-zazhiganiya" },
      { slug: "vysokovoltnye-provoda", label: "Высоковольтные провода", stems: [], image: "vysokovoltnye-provoda" },
      { slug: "tramblery-i-kommutatory", label: "Трамблёры и коммутаторы", stems: [], image: "tramblery-i-kommutatory" },
    ],
  },
  {
    slug: "ohlazhdenie", label: "Охлаждение и отопление", image: "ohlazhdenie", children: [
      { slug: "radiatory", label: "Радиаторы", stems: [], image: "radiatory" },
      { slug: "termostaty", label: "Термостаты", stems: [], image: "termostaty" },
      { slug: "vodyanye-nasosy", label: "Водяные насосы", stems: [], image: "vodyanye-nasosy" },
      { slug: "patrubki-i-shlangi", label: "Патрубки и шланги", stems: [], image: "patrubki-i-shlangi" },
      { slug: "ventilyatory", label: "Вентиляторы и моторы отопителя", stems: [], image: "ventilyatory" },
      { slug: "rasshiritelnye-bachki", label: "Бачки и крышки", stems: [], image: "rasshiritelnye-bachki" },
      { slug: "radiatory-otopitelya", label: "Радиаторы и краны отопителя", stems: [], image: "radiatory-otopitelya" },
      { slug: "konditsioner", label: "Кондиционер", stems: [], image: "konditsioner" },
      { slug: "avtonomnye-otopiteli", label: "Автономные отопители", stems: [], image: "avtonomnye-otopiteli" },
      { slug: "podogrevateli-dvigatelya", label: "Подогреватели двигателя", stems: [], image: "podogrevateli-dvigatelya" },
      { slug: "utepliteli-dvigatelya", label: "Утеплители двигателя", stems: [], image: "utepliteli-dvigatelya" },
    ],
  },
  {
    slug: "transmissiya", label: "Трансмиссия", image: "transmissiya", children: [
      { slug: "stseplenie", label: "Сцепление", stems: [], image: "stseplenie" },
      { slug: "shrusy-i-privody", label: "ШРУСы и приводы", stems: [], image: "shrusy-i-privody" },
      { slug: "pylniki-shrus", label: "Пыльники ШРУС", stems: [], image: "pylniki-shrus" },
      { slug: "krestoviny-i-podshipniki", label: "Крестовины и подшипники", stems: [], image: "krestoviny-i-podshipniki" },
      { slug: "kardannye-valy", label: "Карданные валы", stems: [], image: "kardannye-valy" },
      { slug: "kpp-i-reduktory", label: "КПП, редукторы и раздатки", stems: [], image: "kpp-i-reduktory" },
    ],
  },
  {
    slug: "toplivnaya-sistema", label: "Топливная система", image: "toplivnaya-sistema", children: [
      { slug: "toplivnye-nasosy", label: "Топливные насосы", stems: [], image: "toplivnye-nasosy" },
      { slug: "forsunki", label: "Форсунки", stems: [], image: "forsunki" },
      { slug: "toplivoprovody-i-baki", label: "Баки, шланги и крышки", stems: [], image: "toplivoprovody-i-baki" },
      { slug: "karbyuratory", label: "Карбюраторы", stems: [], image: "karbyuratory" },
      { slug: "dizelnaya-apparatura", label: "Дизельная аппаратура", stems: [], image: "dizelnaya-apparatura" },
    ],
  },
  {
    slug: "vyhlopnaya-sistema", label: "Выхлопная система", image: "vyhlopnaya-sistema", children: [
      { slug: "glushiteli", label: "Глушители и резонаторы", stems: [], image: "glushiteli" },
      { slug: "gofry-i-krepleniya", label: "Гофры и крепления", stems: [], image: "gofry-i-krepleniya" },
      { slug: "truby-i-kollektory", label: "Трубы и коллекторы", stems: [], image: "truby-i-kollektory" },
    ],
  },
  {
    slug: "elektrika", label: "Электрооборудование", image: "elektrika", children: [
      { slug: "generatory-i-startery", label: "Генераторы и стартеры", stems: [], image: "generatory-i-startery" },
      { slug: "datchiki", label: "Датчики", stems: [], image: "datchiki" },
      { slug: "predohraniteli-i-rele", label: "Предохранители и реле", stems: [], image: "predohraniteli-i-rele" },
      { slug: "vyklyuchateli-i-provodka", label: "Выключатели и проводка", stems: [], image: "vyklyuchateli-i-provodka" },
      { slug: "zvukovye-signaly", label: "Звуковые сигналы", stems: [], image: "zvukovye-signaly" },
      { slug: "elektromotory", label: "Моторы и приводы", stems: [], image: "elektromotory" },
      { slug: "bloki-upravleniya", label: "Блоки управления", stems: [], image: "bloki-upravleniya" },
    ],
  },
  {
    slug: "akkumulyatory", label: "Аккумуляторы", image: "akkumulyatory", children: [
      { slug: "akkumulyatory-legkovye", label: "Для легковых", stems: [], image: "akkumulyatory-legkovye" },
      { slug: "akkumulyatory-gruzovye", label: "Для грузовых", stems: ["грузов", "190ач", "225ач"], image: "akkumulyatory-gruzovye" },
      { slug: "akkumulyatory-moto", label: "Мото", stems: ["мото"], image: "akkumulyatory-moto" },
      { slug: "zaryadnye-ustroystva", label: "Зарядные устройства", stems: ["зарядн", "пускозаряд"], image: "zaryadnye-ustroystva" },
      { slug: "provoda-i-klemmy", label: "Провода и клеммы", stems: ["клемм", "прикурив"], image: "provoda-i-klemmy" },
    ],
  },
  {
    slug: "avtolampy", label: "Автолампы", image: "avtolampy", children: [
      { slug: "galogennye-lampy", label: "Галогенные", stems: ["галоген", "h1", "h3", "h4", "h7", "h11", "hb3", "hb4"], image: "galogennye-lampy" },
      { slug: "ksenonovye-lampy", label: "Ксеноновые", stems: ["ксенон", "d1s", "d2s", "d3s", "d4s"], image: "ksenonovye-lampy" },
      { slug: "svetodiodnye-lampy", label: "Светодиодные", stems: ["светодиод", "led"], image: "svetodiodnye-lampy" },
      { slug: "signalnye-lampy", label: "Сигнальные и габаритные", stems: ["w5w", "p21w", "py21w", "w21w", "c5w", "габарит", "указател"], image: "signalnye-lampy" },
    ],
  },
  {
    slug: "kuzov-i-optika", label: "Кузов и оптика", image: "kuzov-i-optika", children: [
      { slug: "fary-i-fonari", label: "Фары и фонари", stems: [], image: "fary-i-fonari" },
      { slug: "zerkala", label: "Зеркала", stems: [], image: "zerkala" },
      { slug: "bryzgoviki-i-podkrylki", label: "Брызговики и подкрылки", stems: [], image: "bryzgoviki-i-podkrylki" },
      { slug: "gazovye-upory", label: "Газовые упоры", stems: [], image: "gazovye-upory" },
      { slug: "bampery-i-reshetki", label: "Бамперы и решётки", stems: [], image: "bampery-i-reshetki" },
      { slug: "kuzovnye-paneli", label: "Капоты, крылья, двери", stems: [], image: "kuzovnye-paneli" },
      { slug: "stekla-i-uplotniteli", label: "Стёкла и уплотнители", stems: [], image: "stekla-i-uplotniteli" },
      { slug: "zamki-i-ruchki", label: "Замки, ручки, стеклоподъёмники", stems: [], image: "zamki-i-ruchki" },
      { slug: "moldingi-i-emblemy", label: "Молдинги и эмблемы", stems: [], image: "moldingi-i-emblemy" },
      { slug: "omyvateli-i-stekloochistiteli", label: "Омыватели и стеклоочистители", stems: [], image: "omyvateli-i-stekloochistiteli" },
      { slug: "dopolnitelnyy-svet", label: "Дополнительный свет", stems: [], image: "dopolnitelnyy-svet" },
    ],
  },
  {
    slug: "shchetki", label: "Щётки стеклоочистителя", image: "shchetki", children: [
      { slug: "shchetki-karkasnye", label: "Каркасные", stems: ["каркасн"], image: "shchetki-karkasnye" },
      { slug: "shchetki-beskarkasnye", label: "Бескаркасные", stems: ["бескаркас"], image: "shchetki-beskarkasnye" },
      { slug: "shchetki-gibridnye", label: "Гибридные", stems: ["гибрид"], image: "shchetki-gibridnye" },
      { slug: "shchetki-zadnie", label: "Задние", stems: ["задн"], image: "shchetki-zadnie" },
      { slug: "shchetki-zimnie", label: "Зимние", stems: ["зимн"], image: "shchetki-zimnie" },
      { slug: "rezinki-shchetok", label: "Резинки и адаптеры", stems: ["резинк", "адаптер"], image: "rezinki-shchetok" },
    ],
  },
  {
    slug: "shiny-i-diski", label: "Шины и диски", image: "shiny-i-diski", children: [
      { slug: "shiny-legkovye", label: "Шины легковые", stems: [], image: "shiny-legkovye" },
      { slug: "shiny-gruzovye", label: "Шины грузовые", stems: [], image: "shiny-gruzovye" },
      { slug: "kamery", label: "Камеры и ободные ленты", stems: [], image: "kamery" },
      { slug: "kolesnye-diski", label: "Колёсные диски", stems: [], image: "kolesnye-diski" },
      { slug: "kolpaki", label: "Колпаки", stems: [], image: "kolpaki" },
      { slug: "kolesnyy-krepezh", label: "Колёсный крепёж", stems: [], image: "kolesnyy-krepezh" },
      { slug: "shinomontazh", label: "Вентили, грузики, ремонт шин", stems: [], image: "shinomontazh" },
    ],
  },
  {
    slug: "avtohimiya", label: "Автохимия", image: "avtohimiya", children: [
      { slug: "dlya-kuzova-i-stekol", label: "Для кузова и стёкол", stems: ["стекл", "кузов", "полирол", "антидожд"], image: "dlya-kuzova-i-stekol" },
      { slug: "dlya-salona", label: "Для салона", stems: ["салон", "пластик", "кож", "обивк"], image: "dlya-salona" },
      { slug: "dlya-moyki", label: "Для мойки", stems: ["шампун", "мойк", "бесконтакт"], image: "dlya-moyki" },
      { slug: "dlya-shin-i-diskov", label: "Для шин и дисков", stems: ["шин", "чернител", "колесн"], image: "dlya-shin-i-diskov" },
      { slug: "zhidkost-omyvatelya", label: "Жидкость омывателя", stems: ["омыват", "незамерза", "стеклоомыв"], image: "zhidkost-omyvatelya" },
      { slug: "prisadki", label: "Присадки", stems: ["присадк", "антигел", "октан"], image: "prisadki" },
      { slug: "ochistiteli", label: "Очистители и промывки", stems: ["очистител", "промывк", "размораживател", "обезжириват"], image: "ochistiteli" },
      { slug: "smazki", label: "Смазки", stems: ["смазк", "литол", "солидол", "wd-40", "wd40"], image: "smazki" },
      { slug: "dlya-remonta", label: "Для ремонта", stems: ["герметик", "клей", "преобразов", "антикор", "мовил"], image: "dlya-remonta" },
      { slug: "kraski-i-gruntovki", label: "Краски, грунты, шпатлёвки", stems: ["краск", "эмаль", "грунт", "шпатлевк", "растворител", "антигравий"], image: "kraski-i-gruntovki" },
      { slug: "tehnicheskie-zhidkosti", label: "Технические жидкости", stems: ["adblue", "мочевин", "электролит"], image: "tehnicheskie-zhidkosti" },
    ],
  },
  {
    slug: "aksessuary", label: "Аксессуары", image: "aksessuary", children: [
      { slug: "kovriki", label: "Коврики", stems: [], image: "kovriki" },
      { slug: "chehly", label: "Чехлы и накидки", stems: [], image: "chehly" },
      { slug: "kompressory", label: "Компрессоры и насосы", stems: [], image: "kompressory" },
      { slug: "aromatizatory", label: "Ароматизаторы", stems: [], image: "aromatizatory" },
      { slug: "derzhateli-i-zaryadki", label: "Держатели и зарядки", stems: [], image: "derzhateli-i-zaryadki" },
      { slug: "avtoelektronika", label: "Автоэлектроника", stems: [], image: "avtoelektronika" },
      { slug: "shchetki-i-skrebki", label: "Щётки и скребки", stems: [], image: "shchetki-i-skrebki" },
      { slug: "kanistry-i-voronki", label: "Канистры и воронки", stems: [], image: "kanistry-i-voronki" },
      { slug: "bagazhniki-i-farkopy", label: "Багажники, фаркопы, крепление груза", stems: [], image: "bagazhniki-i-farkopy" },
      { slug: "ramki-i-nakleyki", label: "Рамки и наклейки", stems: [], image: "ramki-i-nakleyki" },
      { slug: "deflektory-i-shtorki", label: "Дефлекторы и шторки", stems: [], image: "deflektory-i-shtorki" },
      { slug: "komfort-v-salone", label: "Комфорт в салоне", stems: [], image: "komfort-v-salone" },
    ],
  },
  {
    slug: "instrumenty", label: "Инструменты", image: "instrumenty", children: [
      { slug: "klyuchi-i-golovki", label: "Ключи и головки", stems: ["ключ", "головк", "трещотк"], image: "klyuchi-i-golovki" },
      { slug: "nabory-instrumentov", label: "Наборы инструментов", stems: ["набор"], image: "nabory-instrumentov" },
      { slug: "domkraty", label: "Домкраты и подставки", stems: ["домкрат", "подставк"], image: "domkraty" },
      { slug: "semniki", label: "Съёмники", stems: ["съемник"], image: "semniki" },
      { slug: "diagnostika", label: "Диагностика и измерения", stems: ["тестер", "мультиметр", "ареометр", "манометр", "щуп", "диагност"], image: "diagnostika" },
      { slug: "otvertki-i-bity", label: "Отвёртки и биты", stems: ["отвертк"], image: "otvertki-i-bity" },
      { slug: "sharnirno-gubtsevyy", label: "Пассатижи и кусачки", stems: ["пассатиж", "плоскогубц", "кусачк", "бокорез", "круглогубц", "клещ"], image: "sharnirno-gubtsevyy" },
      { slug: "slesarnyy-instrument", label: "Слесарный инструмент", stems: ["молот", "кувалд", "зубил", "напильник", "ножовк", "сверл", "метчик", "плашк", "тиск", "струбцин"], image: "slesarnyy-instrument" },
      { slug: "shpritsy-i-maslenki", label: "Шприцы и маслёнки", stems: ["шприц", "масленк", "нагнетател"], image: "shpritsy-i-maslenki" },
      { slug: "fonari", label: "Фонари", stems: ["фонар"], image: "fonari" },
      { slug: "elektroinstrument", label: "Электро- и пневмоинструмент", stems: ["дрел", "шуруповерт", "болгарк", "гайковерт", "паяльник", "перфоратор"], image: "elektroinstrument" },
      { slug: "sredstva-zashchity", label: "Перчатки и средства защиты", stems: ["перчатк", "респиратор", "рукавиц", "краг"], image: "sredstva-zashchity" },
      { slug: "garazhnoe-oborudovanie", label: "Гаражное оборудование", stems: ["лебедк", "подкат", "лежак"], image: "garazhnoe-oborudovanie" },
    ],
  },
  {
    slug: "krepezh", label: "Крепёж", image: "krepezh", children: [
      { slug: "bolty-i-gayki", label: "Болты, гайки, шпильки", stems: [], image: "bolty-i-gayki" },
      { slug: "homuty", label: "Хомуты", stems: [], image: "homuty" },
      { slug: "klipsy", label: "Клипсы и пистоны", stems: [], image: "klipsy" },
      { slug: "styazhki-i-izolenta", label: "Стяжки, изолента, расходники", stems: [], image: "styazhki-i-izolenta" },
    ],
  },
  {
    slug: "shlangi-i-fitingi", label: "Шланги, фитинги, РВД", image: "shlangi-i-fitingi", children: [
      { slug: "fitingi-pvh", label: "Фитинги для трубок ПВХ", stems: [], image: "fitingi-pvh" },
      { slug: "fitingi-metallicheskie", label: "Фитинги, штуцеры, угольники", stems: [], image: "fitingi-metallicheskie" },
      { slug: "soediniteli-shlangov", label: "Соединители и переходники шлангов", stems: [], image: "soediniteli-shlangov" },
      { slug: "trubki-i-shlangi-na-metrazh", label: "Трубки и шланги на метраж", stems: [], image: "trubki-i-shlangi-na-metrazh" },
      { slug: "rvd", label: "РВД, рукава и муфты", stems: ["рвд"], image: "rvd" },
      { slug: "bystrosemy", label: "Быстросъёмы и пневморазъёмы", stems: [], image: "bystrosemy" },
    ],
  },
  {
    slug: "tehosmotr", label: "Товары для техосмотра", image: "tehosmotr", children: [
      { slug: "aptechki", label: "Аптечки", stems: ["аптечк"], image: "aptechki" },
      { slug: "ognetushiteli", label: "Огнетушители", stems: ["огнетуш"], image: "ognetushiteli" },
      { slug: "znaki-avariynoy-ostanovki", label: "Знаки аварийной остановки", stems: ["знак", "аварийн"], image: "znaki-avariynoy-ostanovki" },
      { slug: "zhilety-i-buksirnye-trosy", label: "Жилеты и буксировочные тросы", stems: ["жилет", "трос", "буксир"], image: "zhilety-i-buksirnye-trosy" },
      { slug: "nabory-avtomobilista", label: "Наборы автомобилиста", stems: ["автомобилист"], image: "nabory-avtomobilista" },
    ],
  },
  {
    slug: "moto-i-sadovaya-tehnika", label: "Мото- и садовая техника", image: "moto-i-sadovaya-tehnika", children: [
      { slug: "zapchasti-moto", label: "Запчасти для мототехники", stems: [], image: "zapchasti-moto" },
      { slug: "tsepi-i-shiny-pil", label: "Цепи и шины для пил", stems: [], image: "tsepi-i-shiny-pil" },
      { slug: "rashodniki-sadovoy-tehniki", label: "Расходники для садовой техники", stems: [], image: "rashodniki-sadovoy-tehniki" },
      { slug: "sadovaya-tehnika", label: "Садовая техника", stems: [], image: "sadovaya-tehnika" },
    ],
  },
];

/** "filtry" → its section; a subsection slug → its parent section. */
export function findStorefrontSection(slug: string): StorefrontSection | undefined {
  return STOREFRONT_TAXONOMY.find((section) => section.slug === slug || section.children.some((child) => child.slug === slug));
}

/** The picture file for a section or subsection slug, falling back to the section's; null when neither has one. */
export function storefrontSectionImage(slug: string): string | null {
  for (const section of STOREFRONT_TAXONOMY) {
    if (section.slug === slug) return section.image ?? null;
    const child = section.children.find((item) => item.slug === slug);
    if (child) return child.image ?? section.image ?? null;
  }
  return null;
}
