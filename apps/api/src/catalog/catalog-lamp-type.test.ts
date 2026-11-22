import { describe, expect, it } from "vitest";

import { lampKind } from "./catalog-lamp-type.js";

describe("what a lamp's marking says about the lamp", () => {
  // 244 of the 626 lamps of the owner's base had no subsection: their names carry a marking, not a word.
  it.each([
    ["Лампа D2R 12V 35W P32d-3, 4300K LYNXauto", "ksenonovye-lampy"],
    ["Лампа D4R 4300К AVS (1шт) A78352S352S AVS", "ksenonovye-lampy"],
    ["Лампа безцокольная 4 диода (белый) 24 V", "svetodiodnye-lampy"],
    ["Лампа большой цоколь COB 3 W (12 V)", "svetodiodnye-lampy"],
    // Russian «н» typed for the Latin «H»; the LEDs still decide.
    ["лампа н3 12в 13SMD диодов 1*10", "svetodiodnye-lampy"],
    ["Лампа Н13 12v 60/55w Auto-GUR", "galogennye-lampy"],
    ["Лампа фарная 24V 75/70W P45t R2 GSL", "galogennye-lampy"],
    ["L10545 Лампа R2 12V 45/40W P45T-41 LYNXauto", "galogennye-lampy"],
    ["L18027 Лампа H27W/1 12V PG13 LYNXauto", "galogennye-lampy"],
    ["Лампа H2 24V 70W X511", "galogennye-lampy"],
    ["L10965 Лампа накаливания, фара дальнего света PHILIPS 12361 H9", "galogennye-lampy"],
    ["Лампа 12V 21/5W двухконтактная (Брест) Волж.рег.", "signalnye-lampy"],
    ["Лампа 24V R10W BA15S малая FenixPro", "signalnye-lampy"],
    ["L14821 Лампа H21W 12V BAY9S LYNXauto", "signalnye-lampy"],
    ["3930 Лампа T4W 24V BA9s Osram", "signalnye-lampy"],
    ["L13509D Лампа накаливания панели приборов T4.7 12V 1.1W BX8.4d LYNXauto", "signalnye-lampy"],
    ["Лампа 12V 5W (AC) SV8.5 подсветка салона (Длинная) Луч", "signalnye-lampy"],
    ["Лампа 24V C10W освещения салона 41мм (отечественные) FenixPro", "signalnye-lampy"],
    ["+++ L13403 Лампа W2.3W 12V W2.1X4.6D LYNXauto", "signalnye-lampy"],
    ["Лампа малый цоколь 24 V белый", "signalnye-lampy"],
    ["Лампа 24V 21W ( 1- конт. большая) стоп-сигнал, поворот GSL", "signalnye-lampy"],
    ["Лампа автомобильная STARLIGHT, (2,1 х 9,5D), 12 В, 5 Вт 3674819", "signalnye-lampy"],
  ])("%s → %s", (name, slug) => {
    expect(lampKind(name)).toBe(slug);
  });

  it.each([
    "Лампа в ассорт", "Лампа OSRAM 3930", "Лампа белая", "Мотолампа 12V S3 15W P26s Standard NARVA Narva 490143000 мото лампа",
  ])("says nothing about «%s»", (name) => {
    expect(lampKind(name)).toBeNull();
  });
});
