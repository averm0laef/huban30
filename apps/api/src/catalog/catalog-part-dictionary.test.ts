import { describe, expect, it } from "vitest";

import { STOREFRONT_TAXONOMY } from "@an30/contracts";

import { expandAbbreviations, partDictionaryMatch, partDictionarySlugs, partHeadNoun, partSectionFromGroupName, partTypeKey } from "./catalog-part-dictionary.js";

const TREE = new Set(STOREFRONT_TAXONOMY.flatMap((section) => [section.slug, ...section.children.map((child) => child.slug)]));

describe("the shop's part dictionary", () => {
  it("answers only with slugs of the storefront tree", () => {
    expect(partDictionarySlugs().filter((slug) => !TREE.has(slug))).toEqual([]);
  });

  it("finds the noun a 1С name is about", () => {
    expect(partHeadNoun("Амортизатор передний KYB 334305")).toBe("амортизатор");
    expect(partHeadNoun("Передний левый амортизатор газовый")).toBe("амортизатор");
    expect(partHeadNoun("К-т сцепления LUK 620 3001 00")).toBe("сцепления");
    expect(partHeadNoun("KYB 334305 амортизатор")).toBe("амортизатор");
    expect(partHeadNoun("Рулевой наконечник правый")).toBe("наконечник");
    expect(partHeadNoun("Ступичный подшипник")).toBe("подшипник");
    expect(partHeadNoun("Тойота Камри амортизатор")).toBe("камри");
    expect(partHeadNoun("Фаркоп Bosal 1234")).toBe("фаркоп");
    expect(partHeadNoun("Универсальный")).toBe("универсальный");
    expect(partHeadNoun("04465-20540")).toBeNull();
  });

  it("names the kind of part a name is about, whatever the word's form", () => {
    expect(partTypeKey("Колодки тормозные передние")).toBe(partTypeKey("Колодка тормозная задняя"));
    expect(partTypeKey("Лампа OSRAM 3930")).toBe(partTypeKey("3930 Лампа T4W 24V BA9s Osram"));
    expect(partTypeKey("элемент масляного фильтра 7405-1012040 бумага")).toBe(partTypeKey("Элемент масляного фильтра 7405-1012040 м/сетка"));
    expect(partTypeKey("Фильтр масляный LYNXauto")).toBe(partTypeKey("Фильтра масляные"));
  });

  it("takes the two words 1С uses for one part as one kind (names from the owner's base sharing a number)", () => {
    expect(partTypeKey("Помпа водяная N-51 TD27, TD25, TD23, QD32")).toBe(partTypeKey("N-51 Насос водяного охлаждения TD23/TD25/TD27"));
    expect(partTypeKey("Пробка бензобака KENT 80 мм хром")).toBe(partTypeKey("Крышка топливного бака KENT 80мм"));
    expect(partTypeKey("мембрана диафрагма 100-3519150 тип 20")).toBe(partTypeKey("Диафрагма камеры тормозной тип 20"));
    expect(partTypeKey("Гофра 203x60.5")).toBe(partTypeKey("Труба гофрированная с внутр. плетением 60.5X203"));
  });

  it("tells different kinds of part apart", () => {
    expect(partTypeKey("Хомут силовой 20-22мм")).not.toBe(partTypeKey("Ключ рожковый 20*22"));
    expect(partTypeKey("Краска-аэрозоль LUCKY золотая")).not.toBe(partTypeKey("LC-341 Фильтр масляный LYNXauto"));
    expect(partTypeKey("Лампа OSRAM 3930")).not.toBe(partTypeKey("3930 10W-40 SL/CF OPTIMAL (полусинт.мотор.масло) Liqui Moly"));
    expect(partTypeKey("04465-20540")).toBeNull();
  });

  it("spells out 1С shorthand", () => {
    expect(expandAbbreviations("Аморт. пер. лев. KYB")).toBe("амортизатор передний левый kyb");
    expect(expandAbbreviations("Р/к суппорта зад.")).toBe("ремкомплект суппорта задний");
    expect(expandAbbreviations("К-т ГРМ")).toBe("комплект грм");
    expect(expandAbbreviations("Втулка стаб. пер.")).toBe("втулка стабилизатора передний");
    expect(expandAbbreviations("Подш. ступ. зад.")).toBe("подшипник ступицы задний");
    expect(expandAbbreviations("Провода в/в")).toBe("провода высоковольтные");
    expect(expandAbbreviations("Фильтр масл. VIC C-110")).toBe("фильтр масляный vic c-110");
    expect(expandAbbreviations("Щётка д/снега")).toBe("щетка для снега");
    // The base often drops the dot of a short form that cannot be mistaken for a word.
    expect(expandAbbreviations("Шланг торм передний левый")).toBe("шланг тормозной передний левый");
    expect(expandAbbreviations("Замена топл фильтра")).toBe("замена топливный фильтра");
    expect(expandAbbreviations("Втулка стаб перед")).toBe("втулка стабилизатора перед");
    expect(expandAbbreviations("Подшипник ступ зад")).toBe("подшипник ступицы зад");
    expect(expandAbbreviations("Фильтр масл VIC")).toBe("фильтр масляный vic");
    // …but a short form that is also a word keeps needing its dot.
    expect(expandAbbreviations("Шар фаркопа 50 мм")).toBe("шар фаркопа 50 мм");
    expect(expandAbbreviations("Таймер 5 мин")).toBe("таймер 5 мин");
    // A word that merely starts like shorthand is left alone.
    expect(expandAbbreviations("Масло моторное 5W-40 4 л")).toBe("масло моторное 5w-40 4 л");
    expect(expandAbbreviations("Передний левый")).toBe("передний левый");
  });

  it.each([
    // Suspension
    ["Амортизатор передний левый KYB 334305 Toyota Corolla", "amortizatory"],
    ["Амортизатор задний газовый Tokico E2915", "amortizatory"],
    ["Аморт. пер. лев. газ. KYB 339700", "amortizatory"],
    ["Стойка амортизационная задняя", "amortizatory"],
    ["Стойка передняя правая в сборе", "amortizatory"],
    ["Передний левый амортизатор", "amortizatory"],
    ["Амортизатор багажника (упор газовый) 480N", "gazovye-upory"],
    ["Амортизатор капота Toyota Camry", "gazovye-upory"],
    ["Упор газовый крышки багажника", "gazovye-upory"],
    ["Амортизатор рулевой УАЗ", "rulevye-mehanizmy"],
    ["Стойка стабилизатора передняя CTR CLT-11", "stabilizator"],
    ["Втулка стабилизатора переднего D23", "stabilizator"],
    ["Втулка стаб. зад. Toyota 48818-52010", "stabilizator"],
    ["Тяга стабилизатора задняя", "stabilizator"],
    ["Линк передний левый", "stabilizator"],
    ["Пыльник амортизатора с отбойником", "opory-i-pylniki"],
    ["Опора амортизатора передняя", "opory-i-pylniki"],
    ["Опорный подшипник передней стойки", "opory-i-pylniki"],
    ["Отбойник переднего амортизатора", "opory-i-pylniki"],
    ["Проставка под пружину 20мм", "opory-i-pylniki"],
    ["Опора шаровая нижняя 555 SB-3882", "sharovye-opory"],
    ["Шаровая опора нижняя левая", "sharovye-opory"],
    ["Шаровая нижняя Toyota Hilux", "sharovye-opory"],
    ["Ш/о нижняя CBT-49", "sharovye-opory"],
    ["Пружина подвески задняя", "pruzhiny"],
    ["Пружина передняя KYB RA1068", "pruzhiny"],
    ["Рычаг передний нижний левый", "rychagi"],
    ["Рычаг задний поперечный", "rychagi"],
    ["Тяга реактивная задняя", "rychagi"],
    ["Тяга задняя поперечная нижняя", "rychagi"],
    ["Болт развальный с эксцентриком", "rychagi"],
    ["Сайлентблок переднего рычага задний", "saylentbloki"],
    ["С/блок заднего рычага Febest TAB-001", "saylentbloki"],
    ["Втулка рессоры", "ressory"],
    ["Втулка амортизатора заднего", "saylentbloki"],
    ["Рессора задняя 5 листов", "ressory"],
    ["Стремянка рессоры М16", "ressory"],
    ["Подшипник ступицы передней NSK", "stupitsy-i-podshipniki"],
    ["Ступичный подшипник задний", "stupitsy-i-podshipniki"],
    ["Подш. ступ. пер. DAC40740042", "stupitsy-i-podshipniki"],
    ["Ступица задняя в сборе", "stupitsy-i-podshipniki"],
    ["Гайка ступицы М22", "stupitsy-i-podshipniki"],
    ["Кулак поворотный левый", "povorotnye-kulaki"],
    ["Шкворень УАЗ к-т", "povorotnye-kulaki"],
    // Steering
    ["Наконечник рулевой правый 555 SE-3641R", "rulevye-nakonechniki"],
    ["Рулевой наконечник левый", "rulevye-nakonechniki"],
    ["Наконечник рул. тяги наруж.", "rulevye-nakonechniki"],
    ["Тяга рулевая без наконечника", "rulevye-tyagi"],
    ["Рулевая тяга 555 SR-3640", "rulevye-tyagi"],
    ["Пыльник рулевой рейки", "rulevye-reyki-i-gur"],
    ["Рейка рулевая в сборе", "rulevye-reyki-i-gur"],
    ["Насос ГУР", "rulevye-reyki-i-gur"],
    ["Шланг ГУР высокого давления", "rulevye-reyki-i-gur"],
    ["Бачок ГУР", "rulevye-reyki-i-gur"],
    ["Маятник рулевой", "rulevye-mehanizmy"],
    ["Крестовина рулевого вала", "rulevye-mehanizmy"],
    ["Вал рулевой нижний", "rulevye-mehanizmy"],
    // Brakes
    ["Колодки передние Toyota Camry", "tormoznye-kolodki"],
    ["Колодки тормозные задние барабанные", "tormoznye-kolodki"],
    ["Тормозные колодки передние Kashiyama D2118", "tormoznye-kolodki"],
    ["Диск тормозной передний вентилируемый", "tormoznye-diski"],
    ["Тормозной диск задний", "tormoznye-diski"],
    ["Барабан тормозной задний", "tormoznye-barabany"],
    ["Суппорт передний левый", "supporty-i-remkomplekty"],
    ["Ремкомплект суппорта", "supporty-i-remkomplekty"],
    ["Р/к суппорта пер. с поршнем", "supporty-i-remkomplekty"],
    ["Направляющая суппорта", "supporty-i-remkomplekty"],
    ["Поршень суппорта", "supporty-i-remkomplekty"],
    ["Цилиндр тормозной главный", "tormoznye-tsilindry"],
    ["Главный тормозной цилиндр", "tormoznye-tsilindry"],
    ["Цилиндр тормозной задний рабочий", "tormoznye-tsilindry"],
    ["Усилитель тормозов вакуумный", "tormoznye-tsilindry"],
    ["Шланг тормозной передний", "tormoznye-shlangi"],
    ["Трубка тормозная медная", "tormoznye-shlangi"],
    ["Трос ручного тормоза", "trosy-ruchnika"],
    ["Трос ручника левый", "trosy-ruchnika"],
    ["Энергоаккумулятор тип 24/24", "pnevmotormoza"],
    ["Камера тормозная тип 20", "pnevmotormoza"],
    ["Кран тормозной главный", "pnevmotormoza"],
    // Engine
    ["Ремень ГРМ Gates 5469XS", "remni"],
    ["Ремень поликлиновой 6PK1195", "remni"],
    ["Ремень генератора", "remni"],
    ["Приводной ремень 4PK865", "remni"],
    ["Комплект ГРМ с помпой", "grm"],
    ["К-т ГРМ Toyota 1NZ", "grm"],
    ["Цепь ГРМ", "grm"],
    ["Звёздочка распредвала", "grm"],
    ["Ролик натяжной ремня ГРМ", "roliki-i-natyazhiteli"],
    ["Натяжной ролик приводного ремня", "roliki-i-natyazhiteli"],
    ["Натяжитель цепи ГРМ", "roliki-i-natyazhiteli"],
    ["Успокоитель цепи", "roliki-i-natyazhiteli"],
    ["Прокладка клапанной крышки", "prokladki-i-salniki"],
    ["Прокладка масляного фильтра", "prokladki-i-salniki"],
    ["Прокладка ГБЦ", "prokladki-i-salniki"],
    ["Набор прокладок двигателя", "prokladki-i-salniki"],
    ["Комплект втулок стабилизатора", "stabilizator"],
    ["К-т стоек стабилизатора", "stabilizator"],
    ["Комплект шпилек колёсных", "kolesnyy-krepezh"],
    ["Набор отвёрток 6 шт", "otvertki-i-bity"],
    ["Комплект крышек радиатора", "rasshiritelnye-bachki"],
    ["Сальник коленвала передний 35x50x8", "prokladki-i-salniki"],
    ["Сальник привода левый", "shrusy-i-privody"],
    ["Колпачки маслосъёмные к-т", "prokladki-i-salniki"],
    ["Кольцо уплотнительное форсунки", "prokladki-i-salniki"],
    ["Шайба медная сливной пробки", "prokladki-i-salniki"],
    ["Уплотнитель свечного колодца", "prokladki-i-salniki"],
    ["Кольца поршневые STD", "porshnevaya-i-klapany"],
    ["Поршневые кольца к-т", "porshnevaya-i-klapany"],
    ["Поршень двигателя", "porshnevaya-i-klapany"],
    ["Вкладыши коренные STD", "porshnevaya-i-klapany"],
    ["Клапан впускной", "porshnevaya-i-klapany"],
    ["Гидрокомпенсатор", "porshnevaya-i-klapany"],
    ["Головка блока цилиндров", "porshnevaya-i-klapany"],
    ["Болт ГБЦ", "porshnevaya-i-klapany"],
    ["Опора двигателя правая", "opory-dvigatelya"],
    ["Подушка ДВС задняя", "opory-dvigatelya"],
    ["Подушка КПП", "opory-dvigatelya"],
    ["Насос масляный", "sistema-smazki"],
    ["Масляный насос двигателя", "sistema-smazki"],
    ["Поддон двигателя", "sistema-smazki"],
    ["Пробка сливная поддона М14", "sistema-smazki"],
    ["Щуп масляный", "sistema-smazki"],
    ["Турбина Garrett", "turbiny"],
    ["Интеркулер", "turbiny"],
    ["Заслонка дроссельная", "vpusknaya-sistema"],
    ["Патрубок воздушного фильтра", "vpusknaya-sistema"],
    ["Клапан холостого хода", "vpusknaya-sistema"],
    ["Клапан EGR", "vpusknaya-sistema"],
    ["Коллектор впускной", "vpusknaya-sistema"],
    ["Шкив коленвала", "shkivy-i-mahoviki"],
    ["Маховик", "shkivy-i-mahoviki"],
    // Ignition
    ["Свеча зажигания NGK BKR6E", "svechi-zazhiganiya"],
    ["Свеча NGK BPR5ES", "svechi-zazhiganiya"],
    ["Свеча накаливания Denso", "svechi-nakala"],
    ["Катушка зажигания", "katushki-zazhiganiya"],
    ["Модуль зажигания ВАЗ", "katushki-zazhiganiya"],
    ["Провода высоковольтные к-т", "vysokovoltnye-provoda"],
    ["Высоковольтные провода силикон", "vysokovoltnye-provoda"],
    ["Провода в/в Toyota 4A-FE", "vysokovoltnye-provoda"],
    ["Наконечник свечи", "vysokovoltnye-provoda"],
    ["Трамблёр ВАЗ 2108", "tramblery-i-kommutatory"],
    ["Крышка трамблёра", "tramblery-i-kommutatory"],
    ["Бегунок", "tramblery-i-kommutatory"],
    ["Коммутатор", "tramblery-i-kommutatory"],
    // Cooling
    ["Радиатор охлаждения двигателя", "radiatory"],
    ["Радиатор Toyota Corolla 1NZ", "radiatory"],
    ["Радиатор печки", "radiatory-otopitelya"],
    ["Радиатор отопителя ВАЗ 2110", "radiatory-otopitelya"],
    ["Кран печки", "radiatory-otopitelya"],
    ["Радиатор кондиционера", "konditsioner"],
    ["Компрессор кондиционера", "konditsioner"],
    ["Осушитель кондиционера", "konditsioner"],
    ["Термостат 82С", "termostaty"],
    ["Помпа GMB GWT-78A", "vodyanye-nasosy"],
    ["Насос водяной", "vodyanye-nasosy"],
    ["Водяной насос Aisin WPT-018", "vodyanye-nasosy"],
    ["Патрубок радиатора верхний", "patrubki-i-shlangi"],
    ["Шланг радиатора нижний", "patrubki-i-shlangi"],
    ["Мотор отопителя", "ventilyatory"],
    ["Вентилятор охлаждения радиатора", "ventilyatory"],
    ["Вискомуфта", "ventilyatory"],
    ["Бачок расширительный", "rasshiritelnye-bachki"],
    ["Крышка радиатора 0.9", "rasshiritelnye-bachki"],
    ["Пробка расширительного бачка", "rasshiritelnye-bachki"],
    // Transmission
    ["Диск сцепления Exedy", "stseplenie"],
    ["Корзина сцепления", "stseplenie"],
    ["Сцепление в сборе LUK", "stseplenie"],
    ["К-т сцепления Valeo", "stseplenie"],
    ["Подшипник выжимной", "stseplenie"],
    ["Выжимной подшипник", "stseplenie"],
    ["Цилиндр сцепления главный", "stseplenie"],
    ["Трос сцепления", "stseplenie"],
    ["ШРУС наружный", "shrusy-i-privody"],
    ["Граната наружная ВАЗ 2108", "shrusy-i-privody"],
    ["Привод передний левый в сборе", "shrusy-i-privody"],
    ["Полуось задняя", "shrusy-i-privody"],
    ["Пыльник ШРУСа наружный", "pylniki-shrus"],
    ["Пыльник привода внутренний", "pylniki-shrus"],
    ["Чехол ШРУС", "pylniki-shrus"],
    ["Хомут пыльника ШРУС", "pylniki-shrus"],
    ["Крестовина карданного вала", "krestoviny-i-podshipniki"],
    ["Подшипник 6204 2RS", "krestoviny-i-podshipniki"],
    ["Вал карданный задний", "kardannye-valy"],
    ["Подшипник подвесной карданного вала", "kardannye-valy"],
    ["Муфта карданного вала эластичная", "kardannye-valy"],
    ["Синхронизатор 3-4 передачи", "kpp-i-reduktory"],
    ["Трос КПП", "kpp-i-reduktory"],
    ["Кулиса КПП", "kpp-i-reduktory"],
    ["Редуктор заднего моста", "kpp-i-reduktory"],
    ["Подшипник первичного вала КПП", "kpp-i-reduktory"],
    // Electrics
    ["Генератор 14V 80A", "generatory-i-startery"],
    ["Стартер редукторный", "generatory-i-startery"],
    ["Щётки генератора к-т", "generatory-i-startery"],
    ["Реле втягивающее стартера", "generatory-i-startery"],
    ["Реле-регулятор напряжения", "generatory-i-startery"],
    ["Диодный мост генератора", "generatory-i-startery"],
    ["Бендикс стартера", "generatory-i-startery"],
    ["Датчик температуры охлаждающей жидкости", "datchiki"],
    ["Датчик давления масла", "datchiki"],
    ["Датчик ABS передний левый", "datchiki"],
    ["Датчик износа тормозных колодок", "datchiki"],
    ["Лямбда-зонд", "datchiki"],
    ["Расходомер воздуха", "datchiki"],
    ["Предохранитель 10А мини", "predohraniteli-i-rele"],
    ["Реле поворотов", "predohraniteli-i-rele"],
    ["Реле 4-контактное 12V 30A", "predohraniteli-i-rele"],
    ["Блок предохранителей", "predohraniteli-i-rele"],
    ["Выключатель стоп-сигнала", "vyklyuchateli-i-provodka"],
    ["Переключатель подрулевой", "vyklyuchateli-i-provodka"],
    ["Замок зажигания", "vyklyuchateli-i-provodka"],
    ["Разъём лампы H4", "vyklyuchateli-i-provodka"],
    ["Колодка разъёма 4-контактная", "vyklyuchateli-i-provodka"],
    ["Клемма обжимная кольцевая", "vyklyuchateli-i-provodka"],
    ["Сигнал звуковой 12V", "zvukovye-signaly"],
    ["Звуковой сигнал улитка", "zvukovye-signaly"],
    ["Мотор стеклоподъёмника", "elektromotory"],
    ["Активатор замка двери", "elektromotory"],
    ["Блок управления двигателем", "bloki-upravleniya"],
    ["Клемма аккумулятора свинцовая", "provoda-i-klemmy"],
    ["Провода пусковые 400А", "provoda-i-klemmy"],
    // Fuel
    ["Насос топливный электрический", "toplivnye-nasosy"],
    ["Топливный насос Bosch", "toplivnye-nasosy"],
    ["Бензонасос", "toplivnye-nasosy"],
    ["Сетка бензонасоса", "toplivnye-nasosy"],
    ["Форсунка топливная", "forsunki"],
    ["Шланг топливный 8мм", "toplivoprovody-i-baki"],
    ["Крышка бензобака", "toplivoprovody-i-baki"],
    ["Клапан адсорбера", "toplivoprovody-i-baki"],
    ["Карбюратор ВАЗ 2107", "karbyuratory"],
    ["Ремкомплект карбюратора", "karbyuratory"],
    ["ТНВД", "dizelnaya-apparatura"],
    ["Распылитель форсунки", "dizelnaya-apparatura"],
    // Exhaust
    ["Глушитель задняя часть", "glushiteli"],
    ["Резонатор", "glushiteli"],
    ["Гофра глушителя 50x200", "gofry-i-krepleniya"],
    ["Хомут глушителя D55", "gofry-i-krepleniya"],
    ["Прокладка глушителя", "gofry-i-krepleniya"],
    ["Кольцо глушителя", "gofry-i-krepleniya"],
    ["Подушка глушителя", "gofry-i-krepleniya"],
    ["Труба приёмная", "truby-i-kollektory"],
    ["Коллектор выпускной", "truby-i-kollektory"],
    // Body and lights
    ["Фара левая", "fary-i-fonari"],
    ["Фара противотуманная правая", "fary-i-fonari"],
    ["Фонарь задний правый", "fary-i-fonari"],
    ["Задний фонарь левый Toyota Corolla", "fary-i-fonari"],
    ["Повторитель поворота", "fary-i-fonari"],
    ["Стекло фары левое", "fary-i-fonari"],
    ["Фара рабочего света светодиодная 48W", "dopolnitelnyy-svet"],
    ["Балка светодиодная 120W", "dopolnitelnyy-svet"],
    ["ДХО универсальные", "dopolnitelnyy-svet"],
    ["Зеркало боковое левое", "zerkala"],
    ["Зеркальный элемент правый", "zerkala"],
    ["Брызговики универсальные", "bryzgoviki-i-podkrylki"],
    ["Подкрылок передний левый", "bryzgoviki-i-podkrylki"],
    ["Защита картера", "bryzgoviki-i-podkrylki"],
    ["Бампер передний", "bampery-i-reshetki"],
    ["Решётка радиатора", "bampery-i-reshetki"],
    ["Капот", "kuzovnye-paneli"],
    ["Крыло переднее левое", "kuzovnye-paneli"],
    ["Порог левый", "kuzovnye-paneli"],
    ["Стекло лобовое", "stekla-i-uplotniteli"],
    ["Уплотнитель двери", "stekla-i-uplotniteli"],
    ["Ручка двери наружная", "zamki-i-ruchki"],
    ["Замок капота", "zamki-i-ruchki"],
    ["Трос капота", "zamki-i-ruchki"],
    ["Стеклоподъёмник передний левый", "zamki-i-ruchki"],
    ["Молдинг двери", "moldingi-i-emblemy"],
    ["Эмблема Toyota", "moldingi-i-emblemy"],
    ["Форсунка омывателя лобового стекла", "omyvateli-i-stekloochistiteli"],
    ["Насос омывателя", "omyvateli-i-stekloochistiteli"],
    ["Моторчик стеклоочистителя задний", "omyvateli-i-stekloochistiteli"],
    ["Бачок омывателя", "omyvateli-i-stekloochistiteli"],
    ["Рычаг стеклоочистителя", "omyvateli-i-stekloochistiteli"],
    ["Трапеция стеклоочистителя", "omyvateli-i-stekloochistiteli"],
    ["Резинка щётки стеклоочистителя 600мм", "rezinki-shchetok"],
    // Wheels
    ["Шина 205/55 R16 Yokohama", "shiny-i-diski"],
    ["Автошина 185/65R15 зимняя", "shiny-i-diski"],
    ["Шина грузовая 11.00R20", "shiny-gruzovye"],
    ["Камера 175/70 R13", "kamery"],
    ["Автокамера R15", "kamery"],
    ["Лента ободная 20", "kamery"],
    ["Диск колёсный R15 5x100", "kolesnye-diski"],
    ["Диск литой R16", "kolesnye-diski"],
    ["Колпаки колёс R14", "kolpaki"],
    ["Гайка колёсная М12х1.5 конус", "kolesnyy-krepezh"],
    ["Болт колёсный M12x1.5", "kolesnyy-krepezh"],
    ["Секретки М12х1.25", "kolesnyy-krepezh"],
    ["Шпилька колёсная", "kolesnyy-krepezh"],
    ["Вентиль бескамерный TR413", "shinomontazh"],
    ["Грузики балансировочные", "shinomontazh"],
    ["Жгут для ремонта бескамерных шин", "shinomontazh"],
    // Fasteners
    ["Болт М8х40", "bolty-i-gayki"],
    ["Гайка М10", "bolty-i-gayki"],
    ["Шайба 8 гровер", "bolty-i-gayki"],
    ["Саморез 4.2x16", "bolty-i-gayki"],
    ["Хомут червячный 16-27", "homuty"],
    ["Хомут пластиковый 200мм", "styazhki-i-izolenta"],
    ["Стяжка пластиковая 300мм", "styazhki-i-izolenta"],
    ["Изолента ПВХ синяя", "styazhki-i-izolenta"],
    ["Лента изоляционная ПВХ", "styazhki-i-izolenta"],
    ["Клипса крепления обшивки", "klipsy"],
    ["Пистон обшивки двери", "klipsy"],
    // Accessories
    ["Коврики салона резиновые", "kovriki"],
    ["Коврик в багажник", "kovriki"],
    ["Чехол на руль", "chehly"],
    ["Оплётка руля кожа", "chehly"],
    ["Накидка на сиденье с подогревом", "komfort-v-salone"],
    ["Компрессор автомобильный 35 л/мин", "kompressory"],
    ["Насос ножной", "kompressory"],
    ["Ароматизатор подвесной", "aromatizatory"],
    ["Держатель телефона магнитный", "derzhateli-i-zaryadki"],
    ["Зарядное устройство USB в прикуриватель", "derzhateli-i-zaryadki"],
    ["Разветвитель прикуривателя", "derzhateli-i-zaryadki"],
    ["Видеорегистратор", "avtoelektronika"],
    ["Автомагнитола 1DIN", "avtoelektronika"],
    ["Камера заднего вида", "avtoelektronika"],
    ["Щётка для снега со скребком", "shchetki-i-skrebki"],
    ["Скребок для льда", "shchetki-i-skrebki"],
    ["Канистра 20 л", "kanistry-i-voronki"],
    ["Воронка с гибким носиком", "kanistry-i-voronki"],
    ["Фаркоп Bosal 1234", "bagazhniki-i-farkopy"],
    ["Багажник на крышу", "bagazhniki-i-farkopy"],
    ["Ремень стяжной 5м с храповиком", "bagazhniki-i-farkopy"],
    ["Рамка номера", "ramki-i-nakleyki"],
    ["Знак Шипы", "ramki-i-nakleyki"],
    ["Дефлектор капота", "deflektory-i-shtorki"],
    ["Шторка солнцезащитная", "deflektory-i-shtorki"],
    ["Набор автомобилиста", "nabory-avtomobilista"],
    ["Трос буксировочный 5 т", "zhilety-i-buksirnye-trosy"],
    // Tools
    ["Ключ свечной 16 мм", "klyuchi-i-golovki"],
    ["Ключ баллонный", "klyuchi-i-golovki"],
    ["Набор ключей комбинированных 12 шт", "klyuchi-i-golovki"],
    ["Головка торцевая 17мм 1/2", "klyuchi-i-golovki"],
    ["Набор головок", "klyuchi-i-golovki"],
    ["Трещотка 1/2", "klyuchi-i-golovki"],
    ["Набор инструментов 82 предмета", "nabory-instrumentov"],
    ["Отвёртка крестовая PH2", "otvertki-i-bity"],
    ["Набор бит", "otvertki-i-bity"],
    ["Пассатижи 180мм", "sharnirno-gubtsevyy"],
    ["Бокорезы", "sharnirno-gubtsevyy"],
    ["Молоток слесарный 500г", "slesarnyy-instrument"],
    ["Сверло по металлу 6мм", "slesarnyy-instrument"],
    ["Диск отрезной 125x1.2", "slesarnyy-instrument"],
    ["Шприц плунжерный", "shpritsy-i-maslenki"],
    ["Пресс-маслёнка М6", "shpritsy-i-maslenki"],
    ["Фонарь налобный светодиодный", "fonari"],
    ["Дрель аккумуляторная", "elektroinstrument"],
    ["Паяльник 40Вт", "elektroinstrument"],
    ["Перчатки х/б с ПВХ", "sredstva-zashchity"],
    ["Домкрат гидравлический 2 т", "domkraty"],
    ["Съёмник масляного фильтра", "semniki"],
    ["Манометр шинный", "diagnostika"],
    ["Мультиметр", "diagnostika"],
    // Chemistry and fluids the dictionary decides itself
    ["Краска аэрозольная чёрная матовая", "kraski-i-gruntovki"],
    ["Грунт акриловый серый", "kraski-i-gruntovki"],
    ["Шпатлёвка со стекловолокном", "kraski-i-gruntovki"],
    ["Растворитель 646", "kraski-i-gruntovki"],
    ["Бумага наждачная P400", "kraski-i-gruntovki"],
    ["Холодная сварка", "dlya-remonta"],
    ["Фиксатор резьбы синий", "dlya-remonta"],
    ["Преобразователь ржавчины", "dlya-remonta"],
    ["Электролит 1 л", "tehnicheskie-zhidkosti"],
    ["Жидкость тормозная DOT-4", "tormoznaya-zhidkost"],
    ["Жидкость ГУР", "zhidkosti-gur"],
    ["Жидкость омывателя -30", "zhidkost-omyvatelya"],
    ["Масло для цепей бензопил", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло двухтактное 1 л", "masla-dlya-moto-i-sadovoy-tekhniki"],
    ["Масло промывочное 4 л", "promyvochnye-masla"],
    ["Губка для мытья авто", "dlya-moyki"],
    ["Салфетка микрофибра", "dlya-moyki"],
    ["Фильтр АКПП Toyota", "filtry-akpp-i-gidravliki"],
    ["Фильтр масляный АКПП", "filtry-akpp-i-gidravliki"],
    // Moto and garden
    ["Цепь пильная 52 звена", "tsepi-i-shiny-pil"],
    ["Шина пильная 16", "tsepi-i-shiny-pil"],
    ["Леска для триммера 2.4мм", "rashodniki-sadovoy-tehniki"],
    ["Мотошина 3.00-18", "zapchasti-moto"],
    ["Камера мото 3.00-18", "zapchasti-moto"],
  ])("%s → %s", (name, slug) => {
    expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
    expect(partDictionaryMatch(name)).toBe(slug);
  });

  it.each([
    // Sections the older rules read better: oils by viscosity, filters and lamps by type, wipers, batteries.
    "Фильтр масляный MANN W914/2", "Фильтр воздушный Sakura A-1109", "Масло моторное 5W-40", "Масло трансмиссионное 75W-90",
    "Лампа H7 12V 55W", "Щётка стеклоочистителя 500 мм", "Аккумулятор 6СТ-60", "АКБ 60 Ач", "Антифриз красный G12 5 л",
    "Тосол -40 10 кг", "Смазка Литол-24", "Аптечка автомобильная",
    "Огнетушитель ОП-2", "Знак аварийной остановки", "Жилет сигнальный", "Дистиллированная вода 5 л", "Герметик прокладок серый",
    // Words with several meanings and no hint which one.
    "Ремень безопасности", "Диск", "Втулка", "Кольцо 24x30", "Насос", "Трос", "Крышка", "Блок", "Опора", "Фонарь",
    "Клапан", "Корпус", "Палец", "Элемент", "Знак",
    // Things the dictionary does not know: the queue, not a guess.
    "Набор", "Ремкомплект", "Услуга доставки", "Пакет подарочный", "Сертификат", "Тойота Камри 2012", "04465-20540",
    "Шаровой кран 1/2", "Стабилизатор напряжения", "Замок навесной", "Цепь", "Катушка для удочки",
  ])("leaves «%s» to the section rules or the queue", (name) => {
    expect(partDictionaryMatch(name)).toBeNull();
  });

  // Names from the owner's 1С base (read-only export of 2026-11-22). Each group below is one cause of a wrong
  // shelf found by looking through a random sample of 300 items; see docs/OWN_CATALOG.md, «Проверка на базе».
  describe("names from the owner's base", () => {
    it.each([
      // «головка» is also the head of a bolt: only «головка блока / цилиндров» or «ГБЦ» means the cylinder head.
      ['Болт "ЗУБР" с шестигранной головкой, DIN 933, M8x12 мм, кл. пр. 8.8, цинк, 8 шт.', "bolty-i-gayki"],
      ["8 Болт шестигранная головка 8*80", "bolty-i-gayki"],
      ["Болт с двухгранной головкой 54091-R8000 NISSAN 54091-R8000", "bolty-i-gayki"],
      ["Болт головки ножа 6*28 с гайкой ШУМАХЕР", "bolty-i-gayki"],
      ["Болт головки блока цилиндров TOYOTA 4/5E 90-", "porshnevaya-i-klapany"],
      ["Болт головки цилиндров 405,406 (М14*100) (ЭТНА)", "porshnevaya-i-klapany"],
      ["Болт М12*1,25*135 головки блока ВАЗ 2108 нового образца БелЗАН 1*10 (9617)", "porshnevaya-i-klapany"],
      ["ST-117-0013     Болт ГБЦ (комплект) TOYOTA 4A-F/5A-F/7A-F/7A-FE", "porshnevaya-i-klapany"],
      ["Болт шатунный Toyota Avensis (T220) 97-03 / Caldina 92-02", "porshnevaya-i-klapany"],
      ["13265-10022 TOYOTA  Болт шатуна TOYOTA 2E/5E/4E 92-", "porshnevaya-i-klapany"],
    ])("bolts: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A seal belongs to the unit it seals; only engine seals and seals with no unit named stay on the general shelf.
      ["BD3126-E0 Сальник ступицы NOK K90311-50008", "stupitsy-i-podshipniki"],
      ["Сальник передней ступицы NISSAN Cedric/Gloria Y32/Y33/Y34, Cube Z10, March K10/K11", "stupitsy-i-podshipniki"],
      ["Манжета ступицы задней 2101", "stupitsy-i-podshipniki"],
      ["Сальник поворотного кулака УАЗ", "povorotnye-kulaki"],
      ["AH2847-M0 NOK Сальник FR привода LH", "shrusy-i-privody"],
      ["Сальник полуоси ВАЗ 2101 задней", "shrusy-i-privody"],
      ["BC3165-E0 Сальник адаптера АКПП NOK K90310-40003", "kpp-i-reduktory"],
      ["Сальник хвостовика УАЗ", "kpp-i-reduktory"],
      ["Сальник раздатки TOYOTA LAND CRUISER", "kpp-i-reduktory"],
      ["Сальник первичного вала ВАЗ 2108", "kpp-i-reduktory"],
      ["Сальник гидромуфты NISSAN", "kpp-i-reduktory"],
      ["Сальник заднего моста ГАЗ-53", "kpp-i-reduktory"],
      ["K90311-36005 Сальник рулевого редуктора TOYOTA LAND CRUISER 92-96", "rulevye-reyki-i-gur"],
      ["Сальник рулевой рейки TOYOTA", "rulevye-reyki-i-gur"],
      ["Сальник насоса ГУР", "rulevye-reyki-i-gur"],
      ["Сальник амортизатора 2101", "amortizatory"],
      ["Сальник ТНВД", "dizelnaya-apparatura"],
      ["90311-38059 Сальник коленчатого/распределительного вала Ajusa 15015300", "prokladki-i-salniki"],
      ["AH1544-F0 Сальник распредвала HONDA F18B/F20B/F22A/F23A (SOHC)", "prokladki-i-salniki"],
      // «коробка» here says which end of the crankshaft, not which unit.
      ["Сальник коленвала коробка ВАЗ 2108", "prokladki-i-salniki"],
      ["Сальник 30*52*10", "prokladki-i-salniki"],
    ])("seals: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A hose or a tube belongs to the system named in its name.
      ["Трубка омывателя силиконовая (100 м; 3-6 мм) Дали-Авто DA-03003", "omyvateli-i-stekloochistiteli"],
      ["Шланг омывателя 5 мм", "omyvateli-i-stekloochistiteli"],
      ["Шланг отопителя (D=6мм) силикон (ЧЕРНЫЙ) бухта 25м", "patrubki-i-shlangi"],
      ["Шланг радиатора STELLOX 8110168SX (SCANIA)", "patrubki-i-shlangi"],
      ["Шланг расширительного бачка ВАЗ 2101 пластиковый красный БРТИ (8952)", "patrubki-i-shlangi"],
      ["Шланг силиконовый,  16 мм", "patrubki-i-shlangi"],
      ["Шланг подкачки внутреннего колеса 25 см металл оплёт", "kompressory"],
      ["Шланг для пистолета подкачки шин быстросъемный. Шланг подкачки колес.", "kompressory"],
      ["шланг насоса без манометра c пластмассовым наконечником", "kompressory"],
      ["Шланг МБС 22 мм (20 м) 22*30,5", "toplivoprovody-i-baki"],
      ["шланг ПГУ 4310-1602590 крючек шт.", "stseplenie"],
      ["Шланг плунжерного шприца 40 см DA-00498", "shpritsy-i-maslenki"],
      // Air lines of a truck or a tractor: the pneumatic system, not a tyre inflator.
      ["Шланг манометра воздуха 70-3801180 (резина) МТЗ (6679)", "pnevmotormoza"],
      ["Шланг пневматический 7,5 м (PA6 d22) желтый", "pnevmotormoza"],
      ["Шланг полуприцепа КАМАЗ 5410-5009059 цветной 17 витков (воздушный) М22", "pnevmotormoza"],
      ["Шланг поливочный ПВХ усиленный, пищевой трехслойный армированный 3/4, 50 м (жёлтый) Вихрь", "rashodniki-sadovoy-tehniki"],
      // Found by running all 502 hoses of the base through the dictionary.
      ["Шланг армированный воздушный от ресивера к компрессору 812W540590007", "pnevmotormoza"],
      ["031.336 Шланг соединительный пневмосистемы M10 L=550mm VOLVO FH/FM STELLOX 84-70724-SX", "pnevmotormoza"],
      ["Шланг с манометром", "kompressory"],
      ["Шланги системы отопления для а/м ВАЗ 2101-2107 2101-8101200Р", "patrubki-i-shlangi"],
      ["Шланг наддувочного воздуха D=115mmL=210-230mm (красный) MB ACTROSAXOR 8833", "turbiny"],
      ["шланг (провод) к п/прицепу электрический витой без разъемов цветной 7,5м шт.", "vyklyuchateli-i-provodka"],
      ["Шланг торм передний левый Nissan Almera (06-) KRAFT KT003162( SAT ST-46210-6N605)", "tormoznye-shlangi"],
    ])("hoses and tubes: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // «Шрус» with a weight is the grease for CV joints (9 of the base's 381 names that start with «шрус»).
      ["Шрус Ярнефть 100 г 1*15  в тубе МасАвто", "smazki"],
      ["шрус 160гр. OILRIGHT 1*15", "smazki"],
      ["Шрус-4 PILOTS 800 г 1*9  МасАвто", "smazki"],
      ["шрус 400 гр. LUXE туба", "smazki"],
      ["CO-7536 ШРУС внешний 30/27 INKO 329148", "shrusy-i-privody"],
      ["Шрус УАЗ 3151/3741 правый короткий мост ТИМКЕН 1445ММ СИБДЕТАЛЬ", "shrusy-i-privody"],
    ])("a part or its grease: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Service marks the staff put in front of a name are not what the product is.
      ["(Рефрежиратор) насос топливный Волга,Газель инжектор (под хомут) Weber", "насос"],
      ["(Америка) Фильтр масляный", "фильтр"],
      ["(15) В РОЗЛИВ Масло моторное Gazpromneft Standard 10W-40 205 л", "масло"],
      ["В РОЗЛИВ 39944 Шампунь Kolibriya Klr-5220 AutoFlex Розовый концентрат", "шампунь"],
      ["АКЦИЯ Подшипник FR ступицы NISSAN WINGROAD/SUNNY 99- (40210-WD200)", "подшипник"],
      ["ШТУЧНО саморезов, винтов, гаек и шайб TUNDRA krep 347 предметов", "саморезов"],
      ["Б/У Щиток тормозного механизма Toyota RAV4 46503-42021", "щиток"],
      ["+++ Клипса крепежная (15руб)", "клипса"],
      // A note in brackets later in the name stays part of it.
      ["Фильтр (сетка) топливного насоса", "фильтр"],
    ])("reads past the staff's marks: %s is about «%s»", (name, noun) => {
      expect(partHeadNoun(name)).toBe(noun);
    });

    it.each([
      // «Ремкомплект для установки колодок» is a kit of the pads, «ремкомплект для б/к шин» a tyre repair kit.
      ["BC-8238 Ремкомплект для установки дисковых колодок LYNXauto", "tormoznye-kolodki"],
      ["ремкомплект для б/к шин в кейсе ATRK-4", "shinomontazh"],
      ["ремкомплект для ремонта б/к шин Nova Bright 47777 47777", "shinomontazh"],
      ["(Рефрежиратор) насос топливный Волга,Газель инжектор (под хомут) Weber", "toplivnye-nasosy"],
      ["АКЦИЯ Подшипник FR ступицы NISSAN WINGROAD/SUNNY 99- (40210-WD200)", "stupitsy-i-podshipniki"],
      // «дисковые» is an adjective of the pads, not the noun «диск».
      ["Дисковые тормозные колодки (УЦЕНКА) 29087", "tormoznye-kolodki"],
      ["Диск тормозной перед TOYOTA VITZ/PLATZ 99-05 ST-43512-52010", "tormoznye-diski"],
      ["Диски тормозные передние 2108 (к-т 2 шт)", "tormoznye-diski"],
    ])("kits and marked names: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A kit for a thing the dictionary does not know: the queue, not a guess from a later word. (Sets «для
      // установки подшипников», «для развальцовки трубок» were listed here until the dictionary learnt to read
      // what a set is for — see the «fifth sample» cases.)
      'Ремкомплект для "планар" 2д (прокладки д. 2655, д 2656, д. 1070, втулка д. 2822, шайба д. 2660)',
      "Набор для рычагов передн подвески (лев+прав) BMW E46 (LMI 1797801) DB68302K",
      // A service, not a product: «Ремонт» in front is not a mark to read past.
      "Ремонт грузового колеса подкачка R17.5-22.5 (до 9 bar)",
      "Замена топл фильтра",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // Car chemistry: the product's own noun decides, the words after it only pick the shelf.
      ["Очиститель карбюратора ELTRANS 400 мл. аэрозоль 1*16", "ochistiteli"],
      ["(Ш) Очиститель форсунок двигателя LAVR LN2110 на 40-60 литров 310 мл", "ochistiteli"],
      ["Очиститель тормозов ABRO 397 г", "ochistiteli"],
      ["Очиститель рук Эко Чистик Хвойный, туба 200мл (1/32)", "ochistiteli"],
      ["Универсальный очиститель KOLIBRYA Klr-0829 3000 250мл", "ochistiteli"],
      ["Очиститель стекла, фар и зеркал 3TON ЗИМНИЙ спрей 550мл МасАвто", "dlya-kuzova-i-stekol"],
      ["Очиститель стекла Kangaroo Fine glass 500 мл ароматизированный Корея 320119", "dlya-kuzova-i-stekol"],
      ["Очиститель интерьера Kangaroo Profoam 4000, пенный, 780мл", "dlya-salona"],
      ["Очиститель обивки салона ASTROHIM 500 мл", "dlya-salona"],
      ["Очиститель дисков GRASS Disk 500 мл", "dlya-shin-i-diskov"],
      ["Полироль панели ASTROHIM Ваниль 125 мл спрей", "dlya-salona"],
      ['Полироль  кож.рез.пласт "Kolibriya"  Tire Wax&Leather c губкой, 250ml      (1/12)', "dlya-salona"],
      ["Полироль пласт./кожи RINKAI, аэроз. 450мл (1/24)", "dlya-salona"],
      ['37399 Полироль кузова "Runway" Консервант бут. 250ml RW2540', "dlya-kuzova-i-stekol"],
      ["AC-8310 ПОЛИРОЛЬ ДЛЯ ФАР GOLDEN WAX, ТУБА 100МЛ AC8310", "dlya-kuzova-i-stekol"],
      ["Полироль-защита для стекла, водоотталкивающая (118мл) HG5640", "dlya-kuzova-i-stekol"],
      ["Автошампунь-суперконцентрат LAVR Green 1:120 - 1:320 Auto Shampoo Super Concentrate, 450мл (1/20)", "dlya-moyki"],
      ['Шампунь "Kolibriya"  AutoFlex /Розовый/, концентрат для бесконт. мойки,   5л', "dlya-moyki"],
      ["В РОЗЛИВ 39944 Шампунь Kolibriya Klr-5220 AutoFlex Розовый концентрат для бесконт. мойки, 20л", "dlya-moyki"],
      ["Активная пена Sintec Dr.Active Extra 23 кг 601731 на разлив!!!", "dlya-moyki"],
      ["Средство для бесконтактной мойки KRAFTER FURTH Green 1кг.", "dlya-moyki"],
      ["Промывка двигателя 10-минутная High TraffiС, 320 мл Ln1009", "ochistiteli"],
      ["Промывка радиатора 3TON концентр.354мл МасАвто 1*12", "ochistiteli"],
      ["Обезжириватель универсальный 3TON TC-545 520 мл", "ochistiteli"],
      ["Аром-р Aroma Car Gel (банка на панель) №705 Green Tea (кор-40шт)", "aromatizatory"],
      // An additive is an additive, whatever it is poured into.
      ["Присадка в топливо", "prisadki"],
      ["1201 BARDAHL N°1 Присадка в моторное масло 400мл", "prisadki"],
      ["Комплекс суперприсадок к маслу для дизельных ДВС HI-GEAR HG2253", "prisadki"],
    ])("car chemistry: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Not for a car: the queue.
      "Пена монтажная TUNDRA PRO, всесезонная, под пистолет, 750 мл", "Средство для мытья посуды AOS",
      'Средство моющее синтетическое порошкообразное "Alpi Expert" для цветного белья 2,5 кг',
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // A Latin look-alike typed inside a Russian word («Cальник» with a Latin C) reads as the Russian word.
      ["Pемень автомобильный  (150 руб)", "remni"],
      ["Kолодки тормозные передние Газель НЕКСТ ADR", "tormoznye-kolodki"],
      ["Cтупица задняя\\ VOLVO FH12(G2/3/4)/ FH16(G2/3)/ FM9(G1/2)", "stupitsy-i-podshipniki"],
      ["Cальник коленвала передний 35x50x8", "prokladki-i-salniki"],
    ])("mistyped letters: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Suspension and engine names the dictionary did not know (batch C of the queue).
      ["ST-42450-52060 Ступичный узел задн. TOYOTA VITZ KSP90,NCP9#,SCP90/RACTIS NCP10#", "stupitsy-i-podshipniki"],
      ["Узел ступичный SAF SK/SKRS/SKRZ 566830.H195", "stupitsy-i-podshipniki"],
      ["Полуступица RR HONDA CR-V 96-01 LHD LH ST-42201-S10-A01", "stupitsy-i-podshipniki"],
      ["Ремкомплект двигателя КАМАЗ (38 наим силиконовый) ЕВРО-2", "prokladki-i-salniki"],
      ["(04111-16230) Ремкомплект двигателя 4A-FE", "prokladki-i-salniki"],
      ["Ремкомплект ДВС QG13DE NISSAN WINGROAD/AD/SUNNY 98-", "prokladki-i-salniki"],
      ["ДВИГАТЕЛЬ ТРАПЕЦИИ СТЕКЛООЧИСТИТЕЛЯ 3741010C6100", "omyvateli-i-stekloochistiteli"],
      ["Картридж подушки двигателя RR TOYOTA RAV4 93-00 двиг. 3S", "opory-dvigatelya"],
      ["Картридж осушителя SCANIA 4-series/ 4324109272", "pnevmotormoza"],
      ["Опора (проставка) пружины нижняя | перед прав/лев | Febest", "opory-i-pylniki"],
      ["GRM14172 Комплект амортизационной опоры | перед прав/лев | G-AUTOPARTS", "opory-i-pylniki"],
      ["Опора подвесная LYNXauto MD-1027", "kardannye-valy"],
      ["ME-3005 Опора глушителя LYNXauto", "gofry-i-krepleniya"],
      ["Страховочные опоры, тренога, 2т, 270-360 мм, комлпект 2 шт JS-02", "domkraty"],
      ["Подушка воздушная со стаканом SP554562K03", "ressory"],
      ["C9836 Подушка дифференциала нижняя зад прав/лев Febest TAB-217", "saylentbloki"],
      ["(Ш) MR132702 Подушка подрамника Febest MSB-V75LWR", "saylentbloki"],
      ["Полурессора 2-лист BPW/ТОНАР 500x470 ЧМЗ", "ressory"],
      ["Футорка левая 53,3307,ЗИЛ Красная Этна", "kolesnyy-krepezh"],
      ["Футорка для грузовика MASUMA OEM_8-94365-143-1 Isuzu", "kolesnyy-krepezh"],
    ])("suspension and engine: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A whole engine and farm hydraulics have no shelf yet: the queue.
      "Двигатель ЯМЗ 238", "Б/У Двигатель BAZ11183 карбюраторный", "Ремкомплект (0438) гидроцилиндра ЦС-100 с/о МТЗ (2598)",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // Lights, body and electrics the dictionary did not know (batches B and H of the queue).
      ["Габарит TOYOTA COROLLA 97-02 черный хрусталь", "fary-i-fonari"],
      ["ST-22-240R Габарит TOYOTA MARK II 93-96 22-240", "fary-i-fonari"],
      ["Номера рамка пластм. с Нижней Защелкой, TOYOTA (черная) (1/30)", "ramki-i-nakleyki"],
      ["95659 Номера рамка пластм. подсветка Боковая, ЧЕРНАЯ", "ramki-i-nakleyki"],
      ["Крепление номера 7см", "ramki-i-nakleyki"],
      ["Крепление бампера Toyota Prius (NHW20) 03-11 (Спереди/ Справа)", "bampery-i-reshetki"],
      ["EP21009 Крепление глушителя TOYOTA PASEO 90-95 EP21009 JIKIU", "gofry-i-krepleniya"],
      ["Крепление FR LH=RH фары SAT STP-53271-0B010", "fary-i-fonari"],
      ["Ремкомплект крепления рессоры 070.582", "ressory"],
      ["Ручка форточки УАЗ со штифтом левая (10884)", "zamki-i-ruchki"],
      ["Кабель электрический 6,5 м (евро удлин) черный с пружиной для грузовиков* (10 шт уп)", "vyklyuchateli-i-provodka"],
      ["Кабель спиральный (15 полюсный) с пластиковыми штекерами арт. 4460087100-E (01-252) 01252 EBS", "vyklyuchateli-i-provodka"],
      ["Кабель HDMI (A) - HDMI (A) 5 м AVS HAA-75", "avtoelektronika"],
      ["Провод с разъемом (6 конт. ) Папа", "vyklyuchateli-i-provodka"],
      ['Провод электр."перекидка EBS/ABS" 7-ми конт D55 4460087000', "vyklyuchateli-i-provodka"],
      ["Провод для зарядки и передачи данных USB - microUSB (для сот.тел.) Luazon, 1 м, смайлик МИКС 865571", "derzhateli-i-zaryadki"],
      ["Провода высокого напряжения 4091 с/н силикон (SLON) BM", "vysokovoltnye-provoda"],
      ['Набор автопровода "Радуга" (ПГВА 1,00мм кв., 7 цветов, по 3м)', "vyklyuchateli-i-provodka"],
      ["Шлейф подрулевой TOYOTA LAND CRUISER 100 98-07 SAT", "vyklyuchateli-i-provodka"],
      ["Втягивающее Г-53 для стартера БАТЭ Сибдеталь СТ230А1-10.800СД (26054)", "generatory-i-startery"],
      ["Указатель температуры воды УК-133АВ ЭИ 8008-3 (12В) электр.МТЗ", "datchiki"],
      ["Указатель тока (амперметр) АП-170 50а Владимир", "datchiki"],
    ])("lights, body, electrics: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Tyre repair, tools, exhaust (batches D, E, G of the queue).
      ["Грибок корд 18/100 мм  Г18к-2", "shinomontazh"],
      ["(R-10) Пластырь радиальный 55*75 1 слой R-10", "shinomontazh"],
      ["Набор для ремонта бескамерных шин, 4 предмета, N01", "shinomontazh"],
      ["набор для ремонта шин 108502", "shinomontazh"],
      ["Комплект для замены цепи ГРМ TOYOTA 1ZZ-FE 00-06", "grm"],
      ["TK-TY280-A Комплект замены цепи ГРМ TOYOTA 1NZ-FE/1NZ-FXE 04-", "grm"],
      ["Пистолет для подкачки шин с манометром до 16атм BR168 168", "kompressory"],
      ["Пистолет накачки колес H32", "kompressory"],
      ["Пистолет продувочный металл хром быстросъем DA-02234", "elektroinstrument"],
      ["Пистолет для продувки с насадкой 200 мм", "elektroinstrument"],
      ["Пистолет для герметика полукорпусной ТехМаш", "slesarnyy-instrument"],
      ['Пистолет для монтажной пены "СТАНДАРТ", пластмассовый корпус Вихрь 73/3/1/1', "slesarnyy-instrument"],
      ["Пистолет-распылитель, 7 режимов полива Вихрь", "rashodniki-sadovoy-tehniki"],
      ["Круг отрезной по металлу (150х22х1.6 мм) Вихрь 73/1/3/33", "slesarnyy-instrument"],
      ['2000 Бумага нажд. "Daesang" Водостойкая Сw 2000-2c 11614', "kraski-i-gruntovki"],
      ["Мойка высокого давления ЗУБР АВД-110, электрическая, макс. 110 Атм", "garazhnoe-oborudovanie"],
      ["Мойка Huter W105-Р", "garazhnoe-oborudovanie"],
      ["Труба гофрированная (сталь 304 трехслойная) 55/300 55300", "gofry-i-krepleniya"],
      ["Металлорукав (гофра) 1м D-90 мм (вн.89 - нар.93) вальцованный DA-01465", "gofry-i-krepleniya"],
      ["Труба приемная УАЗ 469 3151 Нижний Новгород (9393)", "truby-i-kollektory"],
      ["труба глушителя промежуточная !E-line (упрощ. версия) d=127 2-изг", "truby-i-kollektory"],
    ])("tyre repair, tools, exhaust: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Labels typed into the name are not the product (batch F): «Бренд: NOK», «Страна: КИТАЙ», «ЗАМЕНА НА <номер>».
      ["AV7015-R1, Бренд: NOK Колпачок маслосъёмный MITSUBISHI 4G13 / 4G63 / 6G72", "колпачок"],
      ["ST-48521-8H328  Бренд: SAT  Страна: КИТАЙ   применяемость Рулевая тяга Nissan AD 99-08", "тяга"],
      ["11115-28040, Бренд: TOYOTA,Прокладка головки блока TOYOTA IPSUM,CAMRY,HARRIER 2AZFE 05", "прокладка"],
      ["DG11322 ЗАМЕНА НА DG11322-01 Амортизатор передний левый (TOYOTA)", "амортизатор"],
      ["13X1145 Заменен на AVX13X1145 Клиновой ремень 13X1145", "ремень"],
      ["54KWH02Снят, замена ZA-54KWH02D-Y-2CA-01 Ступица колеса | перед |", "ступица"],
      // A service is still read as what it is.
      ["Замена генератора", "замена"],
    ])("reads past labels in the name: %s is about «%s»", (name, noun) => {
      expect(partHeadNoun(name)).toBe(noun);
    });

    it.each([
      // Things that are not for a car, and names that say too little: the queue. (Sets «для стекол и зеркал», «для
      // полива» were listed here until the dictionary learnt to read what a set is for.)
      "Набор универсальный для автомобиля 2021-у",
      "Труба электросварная прямоуг 60*30*2 (6 м)", "Бумага для тахографа", "Пистолет",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // Causes found in the second random sample of 300 (seed 777), looked through after the fixes above.
      ["K90310-50001 Сальник п/оси RR TY Dyna/ToyoAce 95-07, HiLux/Surf 130/18#", "shrusy-i-privody"],
      ["Предохр. MASUMA Силовой 70А (М)", "predohraniteli-i-rele"],
      ["67551 Сигн.звуковые AIRLINE пневматические 12V 600/756Гц, к-т 2шт.", "zvukovye-signaly"],
      ["EX-97PT MT Удлинитель вентиля пластиковый белый длинна 115мм", "shinomontazh"],
      ["Удлинитель 1/2 250 мм", "klyuchi-i-golovki"],
      ["Полироль с тефлоном 250мл, 1/12", "dlya-kuzova-i-stekol"],
      ["Патрубок интеркулера выпускной HOWO T5G мотор MC13", "turbiny"],
      ["Патрубок воздушного фильтра", "vpusknaya-sistema"],
      ["Монтажка 600мм (с торцом под гидравл..домкрат)", "slesarnyy-instrument"],
      ["PT-1021 Гидронатяжитель ремня SAT ST-13540-67020", "roliki-i-natyazhiteli"],
      ["GEN-805T BK/BL Майки GENERATION, велюр, 9 предметов, чёрн./синий, 1/5", "chehly"],
      ["STP-48409-42020 SAT PREMIUM Эксцентрик задний TOYOTA RAV4 '00-", "rychagi"],
      ["Б/У Стоп сигнал Toyota Crown, GRS180; GRS182; GRS181; GRS183; GRS184", "fary-i-fonari"],
      ["Центрирующее кольцо 01345", "kolesnyy-krepezh"],
      ['PL270 Элемент ФГОТ PL-270-1117040 ЕВРО-2 "Fonho" (4809)', "toplivnye-filtry"],
      ["Наконечник шланга подкачки быстросъем 8мм Бронза", "kompressory"],
      ["клапан растормаживания! прицепа 10702070/250624/3222299", "pnevmotormoza"],
      ['110427 Полирующее средство "Polyrole Matte" клубника (флакон 600 мл)', "dlya-salona"],
    ])("second sample: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A cover of a tractor's brake housing is not a seat cover; a floor cloth is not for a car.
      "Чехол 50-3502202 тормозного кожуха МТЗ, ЮМЗ",
      "448-346 Русские Супергерой Тряпка для пола,50*70см,микрофибра,220г/кв,м",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // An adjective made from a part's noun is not that part: «уплотнительное кольцо» is a ring, «барабанные колодки» are pads.
      ["Уплотнительное кольцо под выхлопной коллектор MASUMA 55 х 70", "gofry-i-krepleniya"],
      ["SY-1015 Барабанные тормозные колодки | зад прав/лев | SUFIX", "tormoznye-kolodki"],
      ['Свечной ключ Г-обр. "АвтоДело" с карданом, 16мм. L250мм', "klyuchi-i-golovki"],
      ["076.432-00A_пружинный энергоаккумулятор !24/30 M16x1.5", "pnevmotormoza"],
      // …while an adjective that is the part's own name keeps its entry.
      ["Шкворневой ремкомплект TOYOTA DYNA, TOYOACE KP-433", "povorotnye-kulaki"],
      ["Пара плунжерная КАМАЗ-740.11-240 и мод. ЕВРО-1", "dizelnaya-apparatura"],
      ["Поршневая группа ГАЗ-53 (поршень, гильза) комплект 8шт.", "porshnevaya-i-klapany"],
      ["CBT-44R Шаровая опора нижняя FR CHASER/CRESTA/MARK 92-02 RH", "sharovye-opory"],
      ["Втягивающее реле 30SR0256", "generatory-i-startery"],
      // Found by comparing the shelves of the whole base before and after the rule above.
      ["Антигравийное покрытие RINKAI черный аэрозоль 650 мл 65972", "kraski-i-gruntovki"],
      ['DT-0442 Набор микрофибровых полотенец MS"Microfiber Set"', "dlya-moyki"],
      ["р/к рессорного болта!\\ BPW", "ressory"],
      ["Крепежный шнур резиновый с пластиковыми крюками 2шт (8мм*80см)", "bagazhniki-i-farkopy"],
    ])("adjectives: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      "ПОМПОВЫЙ распылитель с клапаном 2 литра ЖЕЛТЫЙ",
      "Инверторный плазменный резак Ресанта ИПР 40К 65/33", "Термостойкий силиконовый герметик-прокладка АВТОСИЛ 11390",
    ])("does not read «%s» as the noun inside its first adjective", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it("reads «Эксцентриковая шлифовальная машина» as the machine, not as an eccentric bolt", () => {
      // The name used to stay in the queue; the dictionary has known the noun «машина» since the long-tail batch.
      expect(partDictionaryMatch("Эксцентриковая шлифовальная машина Ресанта ЭШМ-125Э 75/6/2")).toBe("elektroinstrument");
    });

    it.each([
      // Causes found in the third random sample of 300 (seed 2025).
      ["Подшипник верхней опоры NISSANBASSARA/CEFIRO/ELGRAND/INFINITI QX4/PATHFINDER", "opory-i-pylniki"],
      ["(Ш) Подшипник верхней опоры SAT ST-54325-4M400", "opory-i-pylniki"],
      ["Жидкий ключ RINKAI, аэроз. 400мл (1/24)", "smazki"],
      ["Колпак ступицы SAF (без ABS) 55595", "stupitsy-i-podshipniki"],
      ['Колпак декоративный "А-1 серебристый" (пруж.) 15" AK1529', "kolpaki"],
      ['Чехол на брелок сигн. "Star-Line" E60/E90, Кожа черная', "avtoelektronika"],
      ["Наконечник насоса, латунь, диаметр 6 мм 3272873", "kompressory"],
      ["Осушитель T0616-3009", "pnevmotormoza"],
      ["Пыльник вилки сцепления ВАЗ 2101 РТИАВТО (3082)", "stseplenie"],
      ["Электробензонасос 406 под хомут(0 530 464 038) HOFER", "toplivnye-nasosy"],
      ["Минимойка автомобильная, погружная, 12 В, мощность 80 Вт, 5 л/мин", "garazhnoe-oborudovanie"],
      ["15330-21011Клапан VVTI TOYOTA COROLLA 1,2NZFE 99- ОРИГИНАЛ", "porshnevaya-i-klapany"],
      ["Универсальный маркерный фонарь ДАЛИ-авто 90.3731-00 жёлтый DA-01763", "fary-i-fonari"],
      ["PR-7276 Защитный комплект амортизаторов | зад прав/лев | LYNXauto D=20", "opory-i-pylniki"],
      // «(задняя опора)» of a reducer's bearing says where it sits, not that it is a strut bearing.
      ["Подшипник редуктора заднего моста 2101 (7807) (задняя опора) Сибдеталь", "kpp-i-reduktory"],
    ])("third sample: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A service named from the unit: «…замена диска сцепления снятие/установка» is work, not a part.
      "МКПП/АКПП замена диска сцепления снятие/установка",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // The rest of the third sample's causes.
      ["возвратная пружина !268x34x5.0 \\\\BPW SN4218-4222 070.124", "supporty-i-remkomplekty"],
      ["Пружина возвратная Volvo 030.224", "supporty-i-remkomplekty"],
      ["Формовочный элемент, отбойник рессоры 8442815SX", "ressory"],
      ['Ароматизаор воздуха подвесной бумажный Mr. Coockie "Ваниль" 2483309', "aromatizatory"],
      ["Гайковерт ручнойДТ4 536580", "klyuchi-i-golovki"],
      ["Гайковерт механический БелАвтоКомплект 270мм с головками 32 и 33 мм 1996646", "klyuchi-i-golovki"],
      ["Гайковерт ударный пневматический 12DR 7500 обмин, 717 Нм AIW12717", "elektroinstrument"],
      ['17906 Бензин "Вершина" "Галоша" (растворитель) Нефрас С2-80/120, бут.1л', "kraski-i-gruntovki"],
      // A name that starts with a motorcycle's make is a motorcycle part, whatever the part is.
      ["Юпитер палец поршневой", "zapchasti-moto"],
      ["ИЖ цепь приводная 104 3В КИРОВ", "zapchasti-moto"],
      ["ВОСХОД ТРОС СЦЕПЛЕНИЯ РОССИЯ", "zapchasti-moto"],
      ["Восход-Минск звездочка малая 13,14,15,16 зуб", "zapchasti-moto"],
      ["Урал реле регулятор 33.3702", "zapchasti-moto"],
      ["Мопед свеча 1шт. C7HNS 4-х тактные", "zapchasti-moto"],
    ])("third sample, the rest: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // «Урал» with a model number is the truck; the make in the middle of a name says what the part fits.
      ["Урал-4320 амортизатор кабины", "amortizatory"],
      ["Крестовина карданного вала УРАЛ 4320 (d-50) Сибдеталь", "krestoviny-i-podshipniki"],
    ])("does not take the truck for the motorcycle: %s → %s", (name, slug) => {
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Tyre repair goods found while reading the queue: «Рк» without the slash, plugs, needles and awls.
      ["Рк шин City Up СА-787", "shinomontazh"],
      ["рк шин (жгут) 5 штук к-т", "shinomontazh"],
      ["Рк карбюратора К-126ГМ Челябинск", "karbyuratory"],
      ["(B-200-6) Жгут В-200-6 мм 200*6 (5)/(25)", "shinomontazh"],
      ["Жгуты (30 шт.) 6мм SIVIK TY-IV-BRT-206 SIVIK", "shinomontazh"],
      ["Жгуты черные 200мм", "shinomontazh"],
      ["Жгут проводов форсунок ВАЗ 2112", "vyklyuchateli-i-provodka"],
      ["Игла для установки жгутов с металлической ручкой TRT75MR-1 арт 1073", "shinomontazh"],
      ["Игла карбюратора ВАЗ К151 с седлом (14840)", "karbyuratory"],
      ["Шило для установки жгутов 14см MARUNI черное IN-06", "shinomontazh"],
      ["Набор шило игла", "shinomontazh"],
      ["8РК 1988 Ремень ручейковый 08PK1988 SHEFT 15090-RS", "remni"],
    ])("tyre repair goods: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it("reads «5-ти ступ», «4-х ступ.», «5-ступ» as the number of gears, not as a hub", () => {
      for (const name of ["Синхронизатор КПП 5-ступ Волга Riginal (4089)", "Датчик заднего хода ВАЗ 2101 4-х ступ. ВК415 СОАТЭ (13997)", "Стопорные кольца Волга, ГАЗель 5-ти ступ (9739)"]) {
        expect(expandAbbreviations(name), name).not.toContain("ступиц");
      }
      expect(expandAbbreviations("подшипник ступ. пер.\\ Fiat Tipo 1.1/1.4 88-95")).toContain("ступицы");
    });

    // Found by reading every word the search would add to a product from its name (22.11.2026): three pieces of
    // shorthand were spelled out wrongly.
    it("reads «мин.» after a number, a slash or a hyphen as minutes, not as «минеральное»", () => {
      for (const name of [
        "Компрессор автомобильный АЛЛИГАТОР, 12V, 120W, производ-сть 30 л./мин., переходники", "Насос для перекачки дизтоплива 51мм 12В (40л/мин.) HOFER",
        "Клей эпоксидный ABRO высокопрочный 60 мин. 57г 1*12", "Сварка холодная POXIPOL 10-мин.прозрачная (14мл) ST02079", "LUXE промывка двигателя 5 мин. 1л (1/12)",
      ]) {
        expect(expandAbbreviations(name), name).not.toContain("минеральн");
      }
      for (const name of [
        "Моторное масло мин. Лукойл СТАНДАРТ 10W-30 SF/CC кан. 4л.", "Масло Лукойл Авангард Ультра 15W-40 мин.CI-4/SL (18л)", "Масло дизельное М8ДМ 20W мин.18л бидон ЛУКОЙЛ",
        "Жидкость для АКПП Totachi ATF DEX-III минер. 4л", "Country ST-508 Масло 2T мин. API ТВ 1л",
      ]) {
        expect(expandAbbreviations(name), name).toContain("минеральное");
      }
    });

    it("reads «рул» after a number as rolls, not as «рулевой»", () => {
      expect(expandAbbreviations("Бумажные полотенца Papia 3сл 2 рул")).not.toContain("рулев");
      expect(expandAbbreviations("Пыльник рул. рейки TG-2002 27-485 TiGUAR")).toContain("рулевой");
    });

    it("reads «брелок сигн.» as the key fob of an alarm, not as a horn", () => {
      expect(expandAbbreviations('Чехол на брелок сигн. "Star-Line" E60/E90, Кожа черная')).toContain("брелок сигнализации");
      expect(expandAbbreviations("69630 Сигн.звуковые М5 VOLGA d=105 12V Улитка")).toContain("сигнал звуковые");
    });

    it("reads «РК» in the middle of a name as the transfer case, not as a repair kit", () => {
      expect(partHeadNoun("Муфта РК включения переднего моста УАЗ косозубая")).toBe("муфта");
      expect(expandAbbreviations("Муфта РК включения переднего моста УАЗ косозубая")).not.toContain("ремкомплект");
    });

    it("leaves a wiring harness named only by its number to the queue", () => {
      expect(partDictionaryMatch("Жгут 2110-3724026")).toBeNull();
    });

    it.each([
      // Causes found in the fourth random sample of 300 (seed 4242).
      ["2901700210 Подогреватель топлива 24v", "dizelnaya-apparatura"],
      ["Подогреватель двиг.предпусковой 2108 карб.8 клап Альянс1,5 кВт", "podogrevateli-dvigatelya"],
      ["Автономный подогреватель двигателя, бензин , дизель 12V/24V 220v", "podogrevateli-dvigatelya"],
      ["аптечка ремонта золотников", "shinomontazh"],
      ["Клемма АКБ универсальная, набор 2 шт. К-013", "provoda-i-klemmy"],
      ["Клемма аккумулятора красная+черная 6-12 В, набор 2 шт 5432277", "provoda-i-klemmy"],
      ['Клемма "мама" серия 6.3 мм наружная (луженая, изолированная полностью) провод 0,75 мм DA-02125', "vyklyuchateli-i-provodka"],
      ["Сервисный комплект амортизатора (пыльник+отбойник) BC1984", "opory-i-pylniki"],
      ["Набивка сальниковая 402 Viktor Reinz Волжский регион", "prokladki-i-salniki"],
      ["MAB-002 C9465 Сайл продольного рычага подвески | зад прав/лев | LYNXauto", "saylentbloki"],
      ["Сайлетблок рессоры ГАЗель (втулка рессорная) РТИАВТО (2991)", "saylentbloki"],
      ["Вал вертикальный 52-2308063 (А) переднего ведущего моста Z-14 МТЗ шт.", "kpp-i-reduktory"],
      ["вал вилки сцепления 14-1601215 шт.", "stseplenie"],
      ["Барашек для шланга подкачки Латунь (d=6мм)/100", "kompressory"],
      ["Ось рычага подвески ВАЗ 21214 нижняя Тольятти (11329)", "rychagi"],
      ["Буквы Камаз 5320-5000000 из 5-ти кт.", "moldingi-i-emblemy"],
      ["Кронштейн рессоры (перед) Scania P/R 84-42839-SX", "ressory"],
      ["Ветошь прессованая 10 кг. (трикотаж) 3285446", "dlya-moyki"],
      ['Ходовые огни "волна"', "dopolnitelnyy-svet"],
      ["Монтажный компонент выхлопной системы 18215-SL5-A00 Honda", "gofry-i-krepleniya"],
      ["Упл.кольцо под вых.коллект. MASUMA 62х75", "gofry-i-krepleniya"],
      ["Кран влагоотделитель с подогр. (24v), с картриджем (64221-3512010) 4 вых. 4324101027", "pnevmotormoza"],
      ["Кран (клапан) 4-х контурный защитный. 094 129 01", "pnevmotormoza"],
      ['+++Быстрый запуск двигателя Caratt "Быстрый старт", аэрозоль, 520 мл 2590421', "tehnicheskie-zhidkosti"],
      ["Стартовая жидкость ABRO 200мл быстрый старт", "tehnicheskie-zhidkosti"],
      ["Жидкость гидроус.руля Step-Up 355мл", "zhidkosti-gur"],
      ["Стеклоочиститель KOLIBRYA Shine Glass Klr-1031, триггер, 500мл", "dlya-kuzova-i-stekol"],
      ["Стеклоочиститель 200мл", "dlya-kuzova-i-stekol"],
      ["Лампа паяльная 1.5л АТ03193", "slesarnyy-instrument"],
      ["Лампа переносная, гаражная 220 В,без ламп (шнур 10 м)", "fonari"],
      ["Подфарник ЗИЛ, УАЗ пластиковый корпус без лампы (11525)", "fary-i-fonari"],
      ["Плата заднего фонаря ВАЗ 2107 левая с лампочками (15091)", "fary-i-fonari"],
      // A lamp's socket is wiring, not a lamp.
      ["Патрон лампы HB1, 12В 3608759", "vyklyuchateli-i-provodka"],
    ])("fourth sample: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // The same nouns with nothing that says where they belong: the queue.
      "Ось качания 50-3000011 длинная МТЗ", "Кран блока ВАЗ металл (12872)", "Вал приема мощности КСФ-2.1 КЗНМ 11.613 ведущий (24029)",
      "Компонент полиэфирный ИЗОЛАН А-131", "Лампа H7 12V 55W",
    ])("leaves «%s» to the section rules or the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // «Роликовый» says how the bearing is built; it is not a tensioner roller (14 such names lay with the rollers).
      ["(FAG 32310A) Подшипник роликовый ступицы наруж. 50x110x42 BPW/MAN 84-40202-SX", "stupitsy-i-podshipniki"],
      ["Подшипник роликовый конический 7510", "krestoviny-i-podshipniki"],
      ["Подшипник натяжного ролика ГРМ", "roliki-i-natyazhiteli"],
    ])("bearings: %s → %s", (name, slug) => {
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // The shelves added with migration 0049: hoses, fittings and hydraulic lines.
      ["Фитинг угловой трубки ПВХ 14 мм PUL14 DA-NP200", "fitingi-pvh"],
      ["Фитинг с винтовым краном трубки ПВХ 06 мм", "fitingi-pvh"],
      ["(Ш) Фитинг тройник трубки ПВХ 15 мм PUT15", "fitingi-pvh"],
      ["Фитинг метал угловой трубки ПВХ (наружная резьба) MPL M 22*1,5 D-6 DA-02001", "fitingi-metallicheskie"],
      ["Фитинг (метал.) прямой трубки ПВХ 14 мм MPUC14 DA-00549", "fitingi-metallicheskie"],
      ["Угольник 18*16 латунь DA-02319", "fitingi-metallicheskie"],
      ["861001 Угольник КАМАЗ М14хМ12 на ПГУ в сборе с гайкой", "fitingi-metallicheskie"],
      ["Тройник 18*18*18 (латунь) (уп.10 шт.)", "fitingi-metallicheskie"],
      ["ШТУЦЕР 16-22", "fitingi-metallicheskie"],
      ["Рем.комплект штуцера трубки ПВХ 04/02 DA-01169", "fitingi-metallicheskie"],
      ["трубка соединительная переходная 14х12 мм металл", "soediniteli-shlangov"],
      ["трубка тройник 14х14х14 мм угол-90гр. металл", "soediniteli-shlangov"],
      ["Соединитель шлангов прямой (елка) D 14 mm DA-02285", "soediniteli-shlangov"],
      ["Наконечник соед,для шлангов прямой с наружней резьбой 10мм (ерш 6 мм)", "soediniteli-shlangov"],
      ["Тройник топливных шлангов 8мм/8мм металл Н.Новгород", "soediniteli-shlangov"],
      ["Трубка медная д-10", "trubki-i-shlangi-na-metrazh"],
      ["Трубка ПВХ 12", "trubki-i-shlangi-na-metrazh"],
      ["Шланг 13 синий", "trubki-i-shlangi-na-metrazh"],
      ["13 ШЛАНГ Промышленный рукав IH-654AA DN 13*016 AG", "trubki-i-shlangi-na-metrazh"],
      ["12 РВД 2SN p=275 d=12 Курск", "rvd"],
      ["08 Муфта 1SN/2SN/2SC d=08", "rvd"],
      ["штуцер (муфта) соединительный РВД 22-24 М18*1.5-М20*1.5", "rvd"],
      ["фланец-патрубок НШ-50 прямой без резьбы шт.", "rvd"],
      ["Быстросъем с внутренней резьбой 1/4", "bystrosemy"],
      ["Быстросьем с наружней резьбой 3/8 с клапаном пневматический", "bystrosemy"],
      ["Пневмо-разъем быстросъемный (папа) елочка Ф10", "bystrosemy"],
      ["Соединитель быстросъемный для шланга 1/2 Вихрь", "bystrosemy"],
      ["ШТУЦЕР ПОД БЫСТРОСЪЕМ С ГАЙКОЙ ПОД ШЛАНГ 6ММ", "bystrosemy"],
      // …heaters, pre-heaters and engine blankets…
      ["Отопитель салона доп. 3 д.24V Сибирь-03", "avtonomnye-otopiteli"],
      ["Автономный отопитель 12V/24V/220V ПЛАСТИКОВАЯ", "avtonomnye-otopiteli"],
      ["Бачок топливный для автономного отопителя 20л.(в сборе)", "avtonomnye-otopiteli"],
      ["Сетка свечи накала отопителя Eberspacher D1LC/D1LCcmpact/D1LE 251688060400", "avtonomnye-otopiteli"],
      ["Горелка для автономки", "avtonomnye-otopiteli"],
      ["Подогреватель двиг.предпусковой 2108 карб.8 клап Альянс1,5 кВт", "podogrevateli-dvigatelya"],
      ["Автономный подогреватель двигателя, бензин , дизель 12V/24V 220v", "podogrevateli-dvigatelya"],
      ["Утеплитель двигателя 160*90 Use Group,эконом", "utepliteli-dvigatelya"],
      ["Автоодеяло для двигателя Cartage, 130 х 80 см, фольгированное 3946160", "utepliteli-dvigatelya"],
      // …and garden machines and workshop heaters.
      ["Бензопила Ресанта БП-6220 70/6/17", "sadovaya-tehnika"],
      ["Мотопомпа Huter MPD-80 для грязной воды", "sadovaya-tehnika"],
      ["Опрыскиватель помповый 2 л Turbo", "sadovaya-tehnika"],
      ["Тепловая электрическая пушка ТЭП-2000Н (компактная) Ресанта", "garazhnoe-oborudovanie"],
      ["Тепловентилятор Ресанта ТВК-3 67/2/5", "garazhnoe-oborudovanie"],
      ['Комплект для ремонта шланга MGF, диаметр 16-20 мм, елочка, переходник тип "С", 2 хомута 3216956', "soediniteli-shlangov"],
      // What stays where it was.
      ["Переходник шланга отопителя 16/16/16 мм. тройник (угол 90) металл ВМ", "patrubki-i-shlangi"],
      ["Фланец редуктора моста УАЗ ОАО УАЗ (9051)", "kpp-i-reduktory"],
      ["Штуцер барашка шланга подкачки", "kompressory"],
    ])("new shelves: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // The same nouns naming other things: not fittings.
      "Муфта зупчатая 70-1721045 вала силового Z=20 МТЗ", "Заглушка замка ремня безопасности ГЛАВДОР GL-29 (2шт.)",
      "Горелка газовая на цанговый баллон, пьeзоподжиг, сопло D22*55мм", "Утеплитель бампера (легковой)",
    ])("does not file «%s» with the hoses, fittings or heaters", (name) => {
      const slug = partDictionaryMatch(name);
      expect(["fitingi-pvh", "fitingi-metallicheskie", "soediniteli-shlangov", "trubki-i-shlangi-na-metrazh", "rvd", "bystrosemy", "avtonomnye-otopiteli", "utepliteli-dvigatelya"])
        .not.toContain(slug);
    });

    it.each([
      // Found by comparing the shelves of the whole base after the new shelves got their words: a fitting that
      // names the system it serves belongs to that system.
      ["Штуцер прокачки тормозов ВАЗ (ключ 8)", "supporty-i-remkomplekty"],
      ["Штуцер главного тормозного цилиндра УАЗ с/о ОАО УАЗ", "tormoznye-tsilindry"],
      ["Соединители тормозных трубок прямые 12 мм металл", "tormoznye-shlangi"],
      ["Угольник м10*м12 в сб. горного тормоза", "pnevmotormoza"],
      ["Тройник для трубок системы омывателя, посадочный диаметр 4,8мм", "omyvateli-i-stekloochistiteli"],
      ["Тройник прикуривателя KS-0303, стразы, черный", "derzhateli-i-zaryadki"],
      ["Рукав КАМАЗ-ЕВРО наддува синий силикон MEGAPOWER 13016095", "turbiny"],
      ["Разветвитель регулируемый 2-х канальный со штуцерами Вихрь", "soediniteli-shlangov"],
      // Fittings the first pass left in the section: the standard or the material names the shelf.
      ["Фитинг с быстросъемом Т-образный 8мм для шлангов продува Стандарт", "bystrosemy"],
      ["Фитинг DK(г) 90° 20х1.5 d=12", "rvd"],
      ["Фитинг (194) JIC-L-(Г) 3/4 D=10 (D3-2) (для шланга высокого давления в автосервисе)", "rvd"],
      ["фитинг прямой 8*8мм никель шт.", "fitingi-metallicheskie"],
      ["фитинг прямой 8*8мм бронза шт.", "fitingi-metallicheskie"],
      ["Фитинг прямой пластик трис, Ф-10 мм МАЯКАВТО", "fitingi-pvh"],
      // An air coupling is not an electrical connector; «разьем» is the base's usual misspelling.
      ["Разъем пневматический (d22) красный DA-00604", "bystrosemy"],
      ['Разъем пневм. быстросьёмный d-10 "ёлка" (25 шт уп)', "bystrosemy"],
      ['Разъем быстросъемный "АЗИЯ" 8mm 20SHJ', "bystrosemy"],
      ["Разьем провода 2 контактный МАМА (6,3мм)с проводом Cargen", "vyklyuchateli-i-provodka"],
      // «ВД» is «высокого давления»; a hose for blowing the cab out goes with the air tools.
      ["Рукав ВД DIN 2-SN-10-330 Gates BALE EURO (6CR2) (M)", "rvd"],
      ["Шланг продува с быстросъемом Силикон L=17,5м, Стандарт", "kompressory"],
      ["Шланг для продува кабины", "kompressory"],
    ])("fittings by the system they serve: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // The long tail of the queue, read word by word (22.11.2026). Notes the staff type into a name:
      ["CBN-33 Снят с производства Опора шаровая | перед прав/лев | CTR", "sharovye-opory"],
      ["GH21220 Снят, замена GH21220T Ступица колеса | зад лев | GMB", "stupitsy-i-podshipniki"],
      ["349035 Снят замена 344811 Амортизатор - Excel-G | зад прав/лев | KYB", "amortizatory"],
      ['Фасовка Хомут червячный 5/8" (10-16мм), уп.5шт', "homuty"],
      ["46606 Фасовка Шпилька MASUMA OEM_43222-70T00 Ms_MLS-195", "bolty-i-gayki"],
      // The slack adjuster of a truck's drum brake is «трещетка» in the trade; the tool is «трещотка».
      ["Трещотка тормозная T11378004", "pnevmotormoza"],
      ["STELLOX 8504083SX трещетка механика прямая. d=38.1 z=28\\Ун 8504083SX", "pnevmotormoza"],
      ["Трещетка BPW (7 отв.) M4420044", "pnevmotormoza"],
      ["Трещетка SCANIA задняя левая (автомат) NEOPLAN 1789561", "pnevmotormoza"],
      ["ТРЕЩЕТКА ТОРМОЗНАЯ T5G ЗАДНЕГО МОСТА ЛЕВАЯ АВТОМАТ WG7129450001", "pnevmotormoza"],
      ["Рычаг регулировочный (трещетка) КАМАЗ 5511-3502136 задний правый", "pnevmotormoza"],
      ["Рычаг регул. тормозной задний L (трещетка) HOWO VALMO0000030", "pnevmotormoza"],
      ['Трещотка 1/4" 72 зубов, резин. ручка ЭВРИКА 1*25', "klyuchi-i-golovki"],
      ["Набор ключей 11пред от 8-24 трещетка", "klyuchi-i-golovki"],
      // Lights named the way the counter names them.
      ["Поворот TOYOTA CORONA 92-94", "fary-i-fonari"],
      ["Поворот в крыло DEPO 212-1409N-UE", "fary-i-fonari"],
      ["Туманка TOYOTA WISH 03- с оправами RH", "fary-i-fonari"],
      ["Фонарь автопоезда 26-3731010 белый", "fary-i-fonari"],
      ["фонарь на лоб", "fonari"],
      ["Фонарь на магните", "fonari"],
      ["фонарик", "fonari"],
      ["Панель светодиодная 12V 6 SMD диодов 24*15мм белая SKYWAY (блистер) 936-011", "svetodiodnye-lampy"],
      // Chemistry.
      ["(Ш) Быстрый старт Тритон ТС-527 520мл", "tehnicheskie-zhidkosti"],
      ["Размораживатель стекол 3TON триггер-спрей, 550 мл МасАвто", "dlya-kuzova-i-stekol"],
      ["Размораживатель стекол и замков LAVR -80C 505мл", "dlya-kuzova-i-stekol"],
      ["Размораживатель замков AIM-ONE Lock de-icer 100мл. DI-100", "smazki"],
      ["WGC0376 Раскоксовка двигателя пенная WOG 520мл (аэрозоль)", "ochistiteli"],
      ["Пенная раскоксовка двигателя 400мл 3ton ТС-552", "ochistiteli"],
      ["OILRIGHТ а/к Мастика резинобитумная 2кг ведро", "kraski-i-gruntovki"],
      ["Паста для притирки клапанов ABRO 100 г.", "dlya-remonta"],
      ["Паста для рук очищающая от мазута 550мл, для сильных загрязнений REXANT", "ochistiteli"],
      // The workshop.
      ["Электрод Ресанта МР-3 Ф2,5 Пачка 1 кг", "garazhnoe-oborudovanie"],
      ["Сварочный аппарат TECH ARC 205 B (Z203) MMA", "garazhnoe-oborudovanie"],
      ["Сварочная проволока Ресанта СВ-08Г2С-O, Ф0,8 мм Катушка 5кг.", "garazhnoe-oborudovanie"],
      ["Сварочная маска МС-2 Ресанта", "sredstva-zashchity"],
      ["Маска защитная (синяя)", "sredstva-zashchity"],
      ["Комбинезон одноразовый Каспер, XL(48-50),спанбонд 40гр м2, 1 шт., белый (ADO-NWF-09)", "sredstva-zashchity"],
      ["Ножницы по металлу Вихрь HM-250R 250 мм, правый рез, двухкомпонентные рукоятки 73/10/8/3", "slesarnyy-instrument"],
      ["Углошлифовальная машина Ресанта УШМ-150/1300 75/12/6", "elektroinstrument"],
      ["Эксцентриковая шлифовальная машина Ресанта ЭШМ-125Э 75/6/2", "elektroinstrument"],
      ['Наконечник для шланга продува "АТ" Ø6мм АТ-0120', "kompressory"],
      ["Наконечник шприца PRESSOL маслонагнетательного 12631", "shpritsy-i-maslenki"],
      // Electrics.
      ["Зажимы для проводов 50 А (крокодил,2 шт)", "provoda-i-klemmy"],
      ['Держатель флажкового предохранителя тип "норма" ( с пров. до 30А, с крышкой, наборный) (10шт. уп.)', "predohraniteli-i-rele"],
      ["Держатель сотового прищепка , черный", "derzhateli-i-zaryadki"],
      ["тумблер 2-х полож. метал.УАЗ Автоконтакт", "vyklyuchateli-i-provodka"],
      ["Адаптер автомобильный 40W 2xType-С ARNEZI A0603018", "derzhateli-i-zaryadki"],
      ["Адаптер CarCharger, /белый с зол./ 3 хUSB, 1А, 2А", "derzhateli-i-zaryadki"],
      // Accessories, wheels, body.
      ["Авточехлы GOBELEN, плотная жаккардовая ткань, 11 предм., карман, 3 молнии, серый GOB-1105 GY/LINE M", "chehly"],
      ["Резинка крепления груза 160см", "bagazhniki-i-farkopy"],
      ['Резинка на багажник "Nova Bright" с крюками 1 м (2 шт)', "bagazhniki-i-farkopy"],
      ["Рамка с защелкой рельеф. Хонда серебро", "ramki-i-nakleyki"],
      ["Груз грузовой 50гр 20шт", "shinomontazh"],
      ["Проставка межвитковая ВАЗ 2108 100-120 мм задние черные комплект БалЗап (8933)", "pruzhiny"],
      ["18446 Проставки под рамку номера с винтами, Короткие 20мм, к-т2 шт. /под перед.номер", "ramki-i-nakleyki"],
      ["Тяга внутренней ручки передней двери правая УАЗ PATRIOT", "zamki-i-ruchki"],
      ["Тяга карбюратора УАЗ голая (14436)", "karbyuratory"],
      ["AUGER 53393 Тяга крана уровня пола DAF CF65/75/85, XF95/105,LF55, L: 290 53393", "pnevmotormoza"],
      ["Опора дифферинциала TOYOTA HARRIER SAT ST-41651-48030", "saylentbloki"],
      ["TAB-314 ОПОРА ДИФФЕРЕНЦИАЛА", "saylentbloki"],
      ["HM-HRVARH Опора трансмиссии зад прав LYNXauto ME-1334", "opory-dvigatelya"],
      ["2-12-460 Подушка полиуретановая рулевой рейки Tochka opory", "rulevye-reyki-i-gur"],
      // More couplings and adapters of the hose shelves.
      ["Муфта ремонтная для шланга 1/2 Вихрь", "soediniteli-shlangov"],
      ["Муфта универсальная быстросъемная (мама) внутреняя резьба 1/4", "bystrosemy"],
      ["муфта разрывная (воздушная) на прицеп с адаптором универсальная м22/м16 шт.", "pnevmotormoza"],
      ["Муфта включения переднего моста УАЗ", "kpp-i-reduktory"],
      ["Адаптер переходник 1/2-3/4 Вихрь", "fitingi-metallicheskie"],
    ])("the long tail of the queue: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // Nothing in the name says which: the queue.
      "трещетка 3", "Рамка 2", "Зубная паста SILCAMED 150гр", "Ножницы хозяйственные Spark Lux 200 мм", "Сварочные работы (аргон)",
      "Адаптер ремня безопасности для детей SKYWAY брензент синий", "Б/У Приборная панель Toyota Corolla AE100", "цепь 315/70",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // «Втулка» was the largest word of the queue (96 names): the unit it is for decides.
      ["Втулка линка TOYOTA DYNA 150/TOYOACE G15/GRANVIA/GRAND HIACE/HILUX/LITE/TOWN/MASTERACE 78-", "stabilizator"],
      ["Втулка крепления радиатора нижняя TOYOTA CORONA/CALDINA/CARINA 92-02", "radiatory"],
      ["Втулка запорная зад полуоси TOYOTA CAMI,RUSH 99 SAT ST-42423-87401", "stupitsy-i-podshipniki"],
      ["014MR FKC Втулка запорная полуоси 35/48/16", "stupitsy-i-podshipniki"],
      ["MT02 Втулка ступицы 4wd MASUMA", "stupitsy-i-podshipniki"],
      ["Втулка поворотного кулака (INN) TY 4WD 87- LN / RZN / KZN / VZN10# / 11# / 13#, LH##", "povorotnye-kulaki"],
      ["Втулка шкворня распорная 53205-3001017 поворотного кулака пластик", "povorotnye-kulaki"],
      ["Втулка цапфы УРАЛ (5/2) (12 Г) 375-2304088", "povorotnye-kulaki"],
      ["90389-19003 Втулка сайлентблока перед прав/лев Febest TT-002", "saylentbloki"],
      ["51391-S84-A01 Втулка торсиона перед прав/лев Febest HSB-060", "saylentbloki"],
      ["TSB-101 Втулка дифференциала Febest", "saylentbloki"],
      ["Втулка полурессоры BPW (d30х60х72) ROSTAR 180.0203159800", "ressory"],
      ["Втулка башмака балансира 5320-2918074 цинк шт.", "ressory"],
      ["Втулка передней стойки верхняя TOYOTA LAND CRUISER PRADO 96-09 / HILUX SURF КОРОБКА 8", "opory-i-pylniki"],
    ])("bushes: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // A bush that names no unit, or one of the cab or of the brake's S-cam, stays in the queue.
      "Втулка мал желтая", "Втулка торсиона 5320-5002025 кабины", "Втулка 40-3001022 бруса МТЗ,ЮМЗ шт.", "Втулка 5320-3501126 разжимного кулака шт.",
      "HSB-051 Втулка TG-51306-S47-003 * Ti·GUAR",
    ])("leaves the bush «%s» to the queue or to its original number", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // Valves, pumps, rings, caps and cocks of the queue that name their unit.
      ["Клапан перепускной ТНВД Евро-338-1111140-20 ЯЗДА", "dizelnaya-apparatura"],
      ["Клапан ТНВД обратки Евро2 качество Createk VG2600080213", "dizelnaya-apparatura"],
      ["Клапан обратки M8 75974", "dizelnaya-apparatura"],
      ["SAMPA 032.126 клапан перепускной!\\ VOLVO FH/FM дв.D12A/C/D/D Gen.6, RVI", "dizelnaya-apparatura"],
      ["Клапан слива конденсата d22, латунь (с резиновым кольцом) (10 шт уп)", "pnevmotormoza"],
      ["Клапан регулировки уровня 096.403", "pnevmotormoza"],
      ["Клапан многоцикловой защиты 092.121", "pnevmotormoza"],
      ["Водоотводный клапан (Knorr:I94095) MB MAN DAF IVECO SCANIA Universal 4.30029", "pnevmotormoza"],
      ["Электромагнитный клапан ABS 811W521606115", "pnevmotormoza"],
      ["Клапан электромагнитный MB WABCO 472 070 639 0", "pnevmotormoza"],
      ["Клапан электромагнитный звукового сигнала CREATEK CK5414", "zvukovye-signaly"],
      ["Клапан электромагнитный изменения фаз ГРМ", "porshnevaya-i-klapany"],
      ["Клапан вып nissan td27t/42t 38x8x117 AUTOWELT VE-33006", "porshnevaya-i-klapany"],
      ["01-23150-SX Клапан IN Audi 100 2.0TD 86> 36x8x95,55 Stellox", "porshnevaya-i-klapany"],
      ["насос для автономки 12v", "avtonomnye-otopiteli"],
      ["Насос на автономный воздушный отопитель 24V R1003", "avtonomnye-otopiteli"],
      ["Насос отопителя доп. электр. STARTVOLT VPM03240 для а/м ГАЗ, МАЗ, КамАЗ VPM03240", "radiatory-otopitelya"],
      ["Насос топ TOYOTA Caldina/Camry/Carina/Corolla/Corona/Gaia/Ipsum/Mark II/Nadia/Picnic/Prem", "toplivnye-nasosy"],
      ["Вибрационный насос НВ-10Н Ресанта 77/8/2", "sadovaya-tehnika"],
      ['Насос дренажный "ВИХРЬ"900', "sadovaya-tehnika"],
      ["Насос для скважины ВИХРЬ ВН-10Н с термозащитой [68/8/5]", "sadovaya-tehnika"],
      ["Кольцо свечного колодца HO F20B/F22B B20B G20A/G25A H22A/H23A STONE JC43035", "prokladki-i-salniki"],
      ["STP-90099-14127 Кольцо трамблера TOYOTA 3,4SFE 92-00", "prokladki-i-salniki"],
      ["Кольцо запорное полуоси ВАЗ 2121 1*10 (68)", "stupitsy-i-podshipniki"],
      ["84-41807-SX Кольцо ступицы 96x145x22 шайба BPW N/R 10-12т 300x200 Sampa 070.210", "stupitsy-i-podshipniki"],
      ["Крышка ступицы 075.053", "stupitsy-i-podshipniki"],
      ["Крышка корпуса термостата УАЗ 100 л/с (13931)", "termostaty"],
      ["Крышка масла УАЗ 402дв. пластмасса (1044)", "sistema-smazki"],
      ['"OC1006 Крышка маслозолевной горловины (1180-46031) (ALFIparts)"', "sistema-smazki"],
      ["Крышка бензонасоса LEDO", "toplivnye-nasosy"],
      ["Крышка подшипника первичного вала УАЗ под тонкий вал РСТ (10709)", "kpp-i-reduktory"],
      ["77023 Кран подъема прицепа ручной GEPARTS 20.0468", "pnevmotormoza"],
      ["Кран разобщительный КАМАЗ 100-3520010 Москва (119)", "pnevmotormoza"],
      ["Кран слива конденсата КАМАЗ, МАЗ, ЗИЛ, ПАЗ (100-3513110) 1003513110", "pnevmotormoza"],
      ["Кран осушителя воздуха 12,5BAR MAN MB Iveco Scania ПОДХОДИТ ДЛЯ VOLVO WA02008", "pnevmotormoza"],
      ["Кран воздухораспределитель с клапаном растормаживания 9710029000", "pnevmotormoza"],
      ["Кран переключения бензобаков УАЗ", "toplivoprovody-i-baki"],
      ["КРАН ОТОПИТЕЛЯ 2101-07 (ШАРОВЫЙ) ШАНС", "radiatory-otopitelya"],
      // Found by comparing the shelves of the whole base after the rules above: «5-ти ступ» is a five-speed
      // gearbox, not a hub, and a submersible pump for diesel fuel is not a garden pump.
      ["Стопорные кольца КПП ВАЗ 2108 - ВАЗ 2115 5-ти ступ (9738)", "kpp-i-reduktory"],
      ["Стопорные кольца Волга, ГАЗель 5-ти ступ (9739)", "bolty-i-gayki"],
      ["Насос для солярки погружной 12V (техн. жидкости) с фильтром DA-00655", "kanistry-i-voronki"],
      ["Насос погружной для перекачки дизтоплива 30л/мин 5А 12В ARNEZI R7005001", "kanistry-i-voronki"],
    ])("valves, pumps, rings, caps, cocks: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      // No unit named, or a unit the storefront has no shelf for: the queue.
      "Клапан УАЗ УМЗ 90лс старого образца ЧАМ (13785)", "Электромагнитный клапан 2106", 'Клапан сброса давления 1/4" (мал)',
      "Насос подъема кабины Scania 30.0373", "Насос НШ-32 правый", "Циркуляционный насос Ц-25/4 СТАНДАРТ Вихрь", "Насос",
      "КОЛЬЦО", "Кольцо желтое", "Запорный кран 094.106", "Кран шаровой 1/2",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // Causes found in the fifth random sample of 300 (seed 5151), taken after the new shelves and the long tail.
      ["Удлинитель наконечника прямой 100 мм пластик", "shinomontazh"],
      ["3302-3116010 Удлинитель наконечника прямой 100 мм желтый", "shinomontazh"],
      ["УГЛОВОЙ УДЛИНИТЕЛЬ КЛАПАНА ДЛЯ НАКАЧКИ", "shinomontazh"],
      ['Удлинитель "АвтоДело" 1/2" 125мм', "klyuchi-i-golovki"],
      ["Сальник генератора 132662", "generatory-i-startery"],
      ["Пыльник наконечника рулевого универсальный 9x24", "rulevye-nakonechniki"],
      ["+++ ПЫЛЬНИК РУЛЕВОЙ РЕЙКИ УНИВЕРСАЛЬНЫЙ FERKB-001", "rulevye-reyki-i-gur"],
      ["Подшипник подвесной привода HONDA MANY 33/55/15", "shrusy-i-privody"],
      ["Подшипник подвесной карданного вала УАЗ", "kardannye-valy"],
      ["Клапан дозирования топлива для ам ГАЗ, МАЗ, КАМАЗ с дв. ЯМЗ-650ISF 3.8D", "dizelnaya-apparatura"],
      ["набор щупов №1 70мм (0,02-0,1мм)(блистер) АвтоDело 40431", "diagnostika"],
      ['Щуп измерительный "SATA" набор 0.05- 1.00мм, 16 пластин 97744', "diagnostika"],
      ["Щуп уровня масла УАЗ короткий 414.1009050 (11655)", "sistema-smazki"],
      ["пластина привода ТНВД 740.11-1111274 (большая) квадратная Евро шт.", "dizelnaya-apparatura"],
      ["Шестерня коронная 26/48 зубов ZL20/ZL30", "kpp-i-reduktory"],
      ["Шестерня ведущая коническая заднего моста КАМАЗ 5320-2402017", "kpp-i-reduktory"],
      ["Пылесос автомобильный Golden Snail с фонарем 12В, 90Вт (шнур 4м) GS 9208", "avtoelektronika"],
      ["Строительный пылесос СП-1500/20 Вихрь 72/19/1", "elektroinstrument"],
      ["37660 Термовыключатель вентилятора радиатора FAE", "datchiki"],
      ["Таблица Дали-Авто грузовой а\\м (полосатая) 560х130 наклейка призма, к-т DA-01607", "ramki-i-nakleyki"],
      ["Колпачек маслосьемный SZ M15A / M18S / G16A впуск / выпуск", "prokladki-i-salniki"],
      ["Фильтр -сетка (маленький насос) большая (90мм*55 м PT21", "toplivnye-filtry"],
      // Found by comparing the shelves of the whole base after «након.» began to be read as «наконечник»: the
      // «наконечник» of a tubeless tyre is its valve, and a hose extension for inflating tyres goes with the hoses.
      ["Након. б/к шины прямой 89 мм", "shinomontazh"],
      ["Удлинитель шланга для подкачки шин с ручкой ерш d=8мм", "kompressory"],
      // …but the head of an inflating gun stays with the compressors (it moved when the rule above was written).
      ["Наконечник для накачки грузовых шин с манометром", "kompressory"],
      // «Набор для …»: what the set is for names its shelf.
      ["Набор для стекол и зеркал ГРАСС", "dlya-kuzova-i-stekol"],
      ["Набор для продува кабины (пистолет,шланг,фитинг D=6мм с быстросъемом) оранжевый", "kompressory"],
      ["Набор для развальцовки трубок 9 пр.(4,8-15,9) АвтоDело", "slesarnyy-instrument"],
      ["Набор для установки подшипников,17 предм. МАЯКАВТО", "semniki"],
      ["Набор для разъединения топливных трубопроводов и системы кондиционирования", "semniki"],
      ["Набор для полива с растягивающимся шлангом 15м Вихрь", "rashodniki-sadovoy-tehniki"],
      ["Комплект для зарядки 3 в 1 LuazON, модель UC-09, АЗУ 1 A, micro USB, 1 A, 1 м, СЗУ 1A, белый", "derzhateli-i-zaryadki"],
      ["Ср-во для очистки стекол 500мл, 1/12", "dlya-kuzova-i-stekol"],
    ])("fifth sample: %s → %s", (name, slug) => {
      expect(TREE.has(slug), `${slug} is in the storefront tree`).toBe(true);
      expect(partDictionaryMatch(name)).toBe(slug);
    });

    it.each([
      "ГАЗ ДЛЯ ПЛИТ (7*4)", "Удлинитель силовой на катушке, СУ-2х1-30/2 (с выкл., 4 розетки) Ресанта", "Колпачек пластиковый VHCAPS",
    ])("leaves «%s» to the queue", (name) => {
      expect(partDictionaryMatch(name)).toBeNull();
    });

    it.each([
      // No system named: sold by the metre for anything — its own shelf since migration 0049, not the cooling one.
      "Шланг синий 10м", "Шланг 6", "шланг в оплетке 56мм (10.3м) бухта", "13 ШЛАНГ Промышленный рукав IH-654AA  DN 13*016  AG",
      "Шланг 16мм армированный",
    ])("files the hose «%s» with the hoses sold by the metre", (name) => {
      expect(partDictionaryMatch(name)).toBe("trubki-i-shlangi-na-metrazh");
    });
  });

  it("reads a section from a 1С group's name", () => {
    expect(partSectionFromGroupName("Ходовая часть")).toBe("podveska");
    expect(partSectionFromGroupName("Детали подвески")).toBe("podveska");
    expect(partSectionFromGroupName("Электрика")).toBe("elektrika");
    expect(partSectionFromGroupName("Двигатель")).toBe("dvigatel");
    expect(partSectionFromGroupName("Крепёж и метизы")).toBe("krepezh");
    expect(partSectionFromGroupName("Шины")).toBe("shiny-i-diski");
    expect(partSectionFromGroupName("Шины и диски")).toBe("shiny-i-diski");
    expect(partSectionFromGroupName("Диски")).toBe("kolesnye-diski");
    expect(partSectionFromGroupName("Мото")).toBe("moto-i-sadovaya-tehnika");
    expect(partSectionFromGroupName("Автокосметика")).toBe("avtohimiya");
    expect(partSectionFromGroupName("Трансмиссия")).toBe("transmissiya");
    expect(partSectionFromGroupName("Топливные фильтры")).toBeNull();
    expect(partSectionFromGroupName("Масло для двигателя")).toBeNull();
    expect(partSectionFromGroupName("Подвеска и рулевое")).toBeNull();
    expect(partSectionFromGroupName("Товары")).toBeNull();
    expect(partSectionFromGroupName("Toyota")).toBeNull();
  });
});
