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
      { slug: "promyvochnye-masla", label: "Промывочные", stems: ["промывочн"] },
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
      { slug: "filtry-akpp-i-gidravliki", label: "Для АКПП и гидравлики", stems: ["акпп", "вариатор", "гидравл", "трансмисс"] },
    ],
  },
  {
    slug: "tormoznaya-sistema", label: "Тормозная система", image: "tormoznaya-sistema", children: [
      { slug: "tormoznye-kolodki", label: "Тормозные колодки", stems: ["колодк", "колодок"], image: "tormoznye-kolodki" },
      { slug: "tormoznye-diski", label: "Тормозные диски", stems: ["диск"], image: "tormoznye-diski" },
      { slug: "tormoznye-barabany", label: "Тормозные барабаны", stems: ["барабан"], image: "tormoznye-barabany" },
      { slug: "tormoznaya-zhidkost", label: "Тормозная жидкость", stems: ["dot", "жидкост"], image: "tormoznaya-zhidkost" },
      { slug: "supporty-i-remkomplekty", label: "Суппорты и ремкомплекты", stems: ["суппорт", "ремкомплект", "направляющ", "пыльник"], image: "supporty-i-remkomplekty" },
      { slug: "tormoznye-tsilindry", label: "Цилиндры и усилители", stems: ["цилиндр", "усилител", "вакуумн"] },
      { slug: "tormoznye-shlangi", label: "Шланги и трубки", stems: ["шланг", "трубк"] },
      { slug: "trosy-ruchnika", label: "Тросы ручного тормоза", stems: ["трос", "ручник", "стояноч"] },
      { slug: "pnevmotormoza", label: "Пневматика тормозов", stems: ["энергоаккум", "пневм", "камер"] },
    ],
  },
  {
    slug: "podveska", label: "Подвеска", image: "podveska", children: [
      { slug: "amortizatory", label: "Амортизаторы и стойки", stems: [] },
      { slug: "pruzhiny", label: "Пружины", stems: [] },
      { slug: "rychagi", label: "Рычаги и тяги", stems: [] },
      { slug: "sharovye-opory", label: "Шаровые опоры", stems: [] },
      { slug: "saylentbloki", label: "Сайлентблоки и втулки", stems: [] },
      { slug: "stabilizator", label: "Стойки и втулки стабилизатора", stems: [] },
      { slug: "stupitsy-i-podshipniki", label: "Ступицы и подшипники", stems: [] },
      { slug: "opory-i-pylniki", label: "Опоры, пыльники, отбойники", stems: [] },
      { slug: "ressory", label: "Рессоры и стремянки", stems: [] },
      { slug: "povorotnye-kulaki", label: "Кулаки и шкворни", stems: [] },
    ],
  },
  {
    slug: "rulevoe-upravlenie", label: "Рулевое управление", image: "rulevoe-upravlenie", children: [
      { slug: "rulevye-nakonechniki", label: "Рулевые наконечники", stems: [] },
      { slug: "rulevye-tyagi", label: "Рулевые тяги", stems: [] },
      { slug: "rulevye-reyki-i-gur", label: "Рейки и насосы ГУР", stems: [] },
      { slug: "rulevye-mehanizmy", label: "Маятники, сошки и валы", stems: [] },
    ],
  },
  {
    slug: "dvigatel", label: "Двигатель", image: "dvigatel", children: [
      { slug: "remni", label: "Ремни", stems: [] },
      { slug: "roliki-i-natyazhiteli", label: "Ролики и натяжители", stems: [] },
      { slug: "grm", label: "Комплекты и цепи ГРМ", stems: [] },
      { slug: "prokladki-i-salniki", label: "Прокладки и сальники", stems: [] },
      { slug: "opory-dvigatelya", label: "Опоры двигателя", stems: [] },
      { slug: "porshnevaya-i-klapany", label: "Поршневая, ГБЦ и клапаны", stems: [] },
      { slug: "sistema-smazki", label: "Система смазки", stems: [] },
      { slug: "turbiny", label: "Турбины и интеркулеры", stems: [] },
      { slug: "vpusknaya-sistema", label: "Впуск и дроссель", stems: [] },
      { slug: "shkivy-i-mahoviki", label: "Шкивы и маховики", stems: [] },
    ],
  },
  {
    slug: "zazhiganie", label: "Система зажигания", image: "zazhiganie", children: [
      { slug: "svechi-zazhiganiya", label: "Свечи зажигания", stems: [] },
      { slug: "svechi-nakala", label: "Свечи накаливания", stems: [] },
      { slug: "katushki-zazhiganiya", label: "Катушки зажигания", stems: [] },
      { slug: "vysokovoltnye-provoda", label: "Высоковольтные провода", stems: [] },
      { slug: "tramblery-i-kommutatory", label: "Трамблёры и коммутаторы", stems: [] },
    ],
  },
  {
    slug: "ohlazhdenie", label: "Охлаждение и отопление", image: "ohlazhdenie", children: [
      { slug: "radiatory", label: "Радиаторы", stems: [] },
      { slug: "termostaty", label: "Термостаты", stems: [] },
      { slug: "vodyanye-nasosy", label: "Водяные насосы", stems: [] },
      { slug: "patrubki-i-shlangi", label: "Патрубки и шланги", stems: [] },
      { slug: "ventilyatory", label: "Вентиляторы и моторы отопителя", stems: [] },
      { slug: "rasshiritelnye-bachki", label: "Бачки и крышки", stems: [] },
      { slug: "radiatory-otopitelya", label: "Радиаторы и краны отопителя", stems: [] },
      { slug: "konditsioner", label: "Кондиционер", stems: [] },
      { slug: "avtonomnye-otopiteli", label: "Автономные отопители", stems: [] },
      { slug: "podogrevateli-dvigatelya", label: "Подогреватели двигателя", stems: [] },
      { slug: "utepliteli-dvigatelya", label: "Утеплители двигателя", stems: [] },
    ],
  },
  {
    slug: "transmissiya", label: "Трансмиссия", image: "transmissiya", children: [
      { slug: "stseplenie", label: "Сцепление", stems: [] },
      { slug: "shrusy-i-privody", label: "ШРУСы и приводы", stems: [] },
      { slug: "pylniki-shrus", label: "Пыльники ШРУС", stems: [] },
      { slug: "krestoviny-i-podshipniki", label: "Крестовины и подшипники", stems: [] },
      { slug: "kardannye-valy", label: "Карданные валы", stems: [] },
      { slug: "kpp-i-reduktory", label: "КПП, редукторы и раздатки", stems: [] },
    ],
  },
  {
    slug: "toplivnaya-sistema", label: "Топливная система", image: "toplivnaya-sistema", children: [
      { slug: "toplivnye-nasosy", label: "Топливные насосы", stems: [] },
      { slug: "forsunki", label: "Форсунки", stems: [] },
      { slug: "toplivoprovody-i-baki", label: "Баки, шланги и крышки", stems: [] },
      { slug: "karbyuratory", label: "Карбюраторы", stems: [] },
      { slug: "dizelnaya-apparatura", label: "Дизельная аппаратура", stems: [] },
    ],
  },
  {
    slug: "vyhlopnaya-sistema", label: "Выхлопная система", image: "vyhlopnaya-sistema", children: [
      { slug: "glushiteli", label: "Глушители и резонаторы", stems: [] },
      { slug: "gofry-i-krepleniya", label: "Гофры и крепления", stems: [] },
      { slug: "truby-i-kollektory", label: "Трубы и коллекторы", stems: [] },
    ],
  },
  {
    slug: "elektrika", label: "Электрооборудование", image: "elektrika", children: [
      { slug: "generatory-i-startery", label: "Генераторы и стартеры", stems: [] },
      { slug: "datchiki", label: "Датчики", stems: [] },
      { slug: "predohraniteli-i-rele", label: "Предохранители и реле", stems: [] },
      { slug: "vyklyuchateli-i-provodka", label: "Выключатели и проводка", stems: [] },
      { slug: "zvukovye-signaly", label: "Звуковые сигналы", stems: [] },
      { slug: "elektromotory", label: "Моторы и приводы", stems: [] },
      { slug: "bloki-upravleniya", label: "Блоки управления", stems: [] },
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
      { slug: "fary-i-fonari", label: "Фары и фонари", stems: [] },
      { slug: "zerkala", label: "Зеркала", stems: [] },
      { slug: "bryzgoviki-i-podkrylki", label: "Брызговики и подкрылки", stems: [] },
      { slug: "gazovye-upory", label: "Газовые упоры", stems: [] },
      { slug: "bampery-i-reshetki", label: "Бамперы и решётки", stems: [] },
      { slug: "kuzovnye-paneli", label: "Капоты, крылья, двери", stems: [] },
      { slug: "stekla-i-uplotniteli", label: "Стёкла и уплотнители", stems: [] },
      { slug: "zamki-i-ruchki", label: "Замки, ручки, стеклоподъёмники", stems: [] },
      { slug: "moldingi-i-emblemy", label: "Молдинги и эмблемы", stems: [] },
      { slug: "omyvateli-i-stekloochistiteli", label: "Омыватели и стеклоочистители", stems: [] },
      { slug: "dopolnitelnyy-svet", label: "Дополнительный свет", stems: [] },
    ],
  },
  {
    slug: "shchetki", label: "Щётки стеклоочистителя", image: "shchetki", children: [
      { slug: "shchetki-karkasnye", label: "Каркасные", stems: ["каркасн"], image: "shchetki-karkasnye" },
      { slug: "shchetki-beskarkasnye", label: "Бескаркасные", stems: ["бескаркас"], image: "shchetki-beskarkasnye" },
      { slug: "shchetki-gibridnye", label: "Гибридные", stems: ["гибрид"], image: "shchetki-gibridnye" },
      { slug: "shchetki-zadnie", label: "Задние", stems: ["задн"], image: "shchetki-zadnie" },
      { slug: "shchetki-zimnie", label: "Зимние", stems: ["зимн"] },
      { slug: "rezinki-shchetok", label: "Резинки и адаптеры", stems: ["резинк", "адаптер"] },
    ],
  },
  {
    slug: "shiny-i-diski", label: "Шины и диски", image: "shiny-i-diski", children: [
      { slug: "shiny-legkovye", label: "Шины легковые", stems: [] },
      { slug: "shiny-gruzovye", label: "Шины грузовые", stems: [] },
      { slug: "kamery", label: "Камеры и ободные ленты", stems: [] },
      { slug: "kolesnye-diski", label: "Колёсные диски", stems: [] },
      { slug: "kolpaki", label: "Колпаки", stems: [] },
      { slug: "kolesnyy-krepezh", label: "Колёсный крепёж", stems: [] },
      { slug: "shinomontazh", label: "Вентили, грузики, ремонт шин", stems: [] },
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
      { slug: "ochistiteli", label: "Очистители и промывки", stems: ["очистител", "промывк", "размораживател", "обезжириват"] },
      { slug: "smazki", label: "Смазки", stems: ["смазк", "литол", "солидол", "wd-40", "wd40"], image: "smazki" },
      { slug: "dlya-remonta", label: "Для ремонта", stems: ["герметик", "клей", "преобразов", "антикор", "мовил"], image: "dlya-remonta" },
      { slug: "kraski-i-gruntovki", label: "Краски, грунты, шпатлёвки", stems: ["краск", "эмаль", "грунт", "шпатлевк", "растворител", "антигравий"] },
      { slug: "tehnicheskie-zhidkosti", label: "Технические жидкости", stems: ["adblue", "мочевин", "электролит"] },
    ],
  },
  {
    slug: "aksessuary", label: "Аксессуары", image: "aksessuary", children: [
      { slug: "kovriki", label: "Коврики", stems: [] },
      { slug: "chehly", label: "Чехлы и накидки", stems: [] },
      { slug: "kompressory", label: "Компрессоры и насосы", stems: [] },
      { slug: "aromatizatory", label: "Ароматизаторы", stems: [] },
      { slug: "derzhateli-i-zaryadki", label: "Держатели и зарядки", stems: [] },
      { slug: "avtoelektronika", label: "Автоэлектроника", stems: [] },
      { slug: "shchetki-i-skrebki", label: "Щётки и скребки", stems: [] },
      { slug: "kanistry-i-voronki", label: "Канистры и воронки", stems: [] },
      { slug: "bagazhniki-i-farkopy", label: "Багажники, фаркопы, крепление груза", stems: [] },
      { slug: "ramki-i-nakleyki", label: "Рамки и наклейки", stems: [] },
      { slug: "deflektory-i-shtorki", label: "Дефлекторы и шторки", stems: [] },
      { slug: "komfort-v-salone", label: "Комфорт в салоне", stems: [] },
    ],
  },
  {
    slug: "instrumenty", label: "Инструменты", image: "instrumenty", children: [
      { slug: "klyuchi-i-golovki", label: "Ключи и головки", stems: ["ключ", "головк", "трещотк"], image: "klyuchi-i-golovki" },
      { slug: "nabory-instrumentov", label: "Наборы инструментов", stems: ["набор"], image: "nabory-instrumentov" },
      { slug: "domkraty", label: "Домкраты и подставки", stems: ["домкрат", "подставк"], image: "domkraty" },
      { slug: "semniki", label: "Съёмники", stems: ["съемник"], image: "semniki" },
      { slug: "diagnostika", label: "Диагностика и измерения", stems: ["тестер", "мультиметр", "ареометр", "манометр", "щуп", "диагност"], image: "diagnostika" },
      { slug: "otvertki-i-bity", label: "Отвёртки и биты", stems: ["отвертк"] },
      { slug: "sharnirno-gubtsevyy", label: "Пассатижи и кусачки", stems: ["пассатиж", "плоскогубц", "кусачк", "бокорез", "круглогубц", "клещ"] },
      { slug: "slesarnyy-instrument", label: "Слесарный инструмент", stems: ["молот", "кувалд", "зубил", "напильник", "ножовк", "сверл", "метчик", "плашк", "тиск", "струбцин"] },
      { slug: "shpritsy-i-maslenki", label: "Шприцы и маслёнки", stems: ["шприц", "масленк", "нагнетател"] },
      { slug: "fonari", label: "Фонари", stems: ["фонар"] },
      { slug: "elektroinstrument", label: "Электро- и пневмоинструмент", stems: ["дрел", "шуруповерт", "болгарк", "гайковерт", "паяльник", "перфоратор"] },
      { slug: "sredstva-zashchity", label: "Перчатки и средства защиты", stems: ["перчатк", "респиратор", "рукавиц", "краг"] },
      { slug: "garazhnoe-oborudovanie", label: "Гаражное оборудование", stems: ["лебедк", "подкат", "лежак"] },
    ],
  },
  {
    slug: "krepezh", label: "Крепёж", image: "krepezh", children: [
      { slug: "bolty-i-gayki", label: "Болты, гайки, шпильки", stems: [] },
      { slug: "homuty", label: "Хомуты", stems: [] },
      { slug: "klipsy", label: "Клипсы и пистоны", stems: [] },
      { slug: "styazhki-i-izolenta", label: "Стяжки, изолента, расходники", stems: [] },
    ],
  },
  {
    slug: "shlangi-i-fitingi", label: "Шланги, фитинги, РВД", image: "shlangi-i-fitingi", children: [
      { slug: "fitingi-pvh", label: "Фитинги для трубок ПВХ", stems: [] },
      { slug: "fitingi-metallicheskie", label: "Фитинги, штуцеры, угольники", stems: [] },
      { slug: "soediniteli-shlangov", label: "Соединители и переходники шлангов", stems: [] },
      { slug: "trubki-i-shlangi-na-metrazh", label: "Трубки и шланги на метраж", stems: [] },
      { slug: "rvd", label: "РВД, рукава и муфты", stems: ["рвд"] },
      { slug: "bystrosemy", label: "Быстросъёмы и пневморазъёмы", stems: [] },
    ],
  },
  {
    slug: "tehosmotr", label: "Товары для техосмотра", image: "tehosmotr", children: [
      { slug: "aptechki", label: "Аптечки", stems: ["аптечк"], image: "aptechki" },
      { slug: "ognetushiteli", label: "Огнетушители", stems: ["огнетуш"], image: "ognetushiteli" },
      { slug: "znaki-avariynoy-ostanovki", label: "Знаки аварийной остановки", stems: ["знак", "аварийн"], image: "znaki-avariynoy-ostanovki" },
      { slug: "zhilety-i-buksirnye-trosy", label: "Жилеты и буксировочные тросы", stems: ["жилет", "трос", "буксир"], image: "zhilety-i-buksirnye-trosy" },
      { slug: "nabory-avtomobilista", label: "Наборы автомобилиста", stems: ["автомобилист"] },
    ],
  },
  {
    slug: "moto-i-sadovaya-tehnika", label: "Мото- и садовая техника", image: "moto-i-sadovaya-tehnika", children: [
      { slug: "zapchasti-moto", label: "Запчасти для мототехники", stems: [] },
      { slug: "tsepi-i-shiny-pil", label: "Цепи и шины для пил", stems: [] },
      { slug: "rashodniki-sadovoy-tehniki", label: "Расходники для садовой техники", stems: [] },
      { slug: "sadovaya-tehnika", label: "Садовая техника", stems: [] },
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
