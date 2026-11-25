import { describe, expect, it } from "vitest";

import { CAR_LOOKS, carLook } from "./car-look";

describe("carLook", () => {
  it.each([
    [{ body: "Хэтчбэк", engine: "1.4 л VVT-i", make: "Toyota", model: "Corolla" }, "hatch"],
    [{ body: "седан", engine: "1.6 л", make: "Lada", model: "Vesta" }, "sedan-compact"],
    [{ body: "седан", engine: "2.5 л", make: "Toyota", model: "Camry" }, "sedan"],
    [{ body: "седан", engine: "4.0 л", make: "Toyota", model: "Crown Majesta" }, "sedan-large"],
    [{ body: "универсал", engine: "1.5 л", make: "Toyota", model: "Probox" }, "wagon"],
    [{ body: "Хэтчбэк", engine: "0.66 л", make: "Honda", model: "N-BOX" }, "kei"],
    [{ body: "Хэтчбэк", engine: "0.7", make: "Daihatsu", model: "Неизвестная" }, "kei"],
    [{ body: "SUV", engine: "2.0 л", make: "Toyota", model: "RAV4" }, "crossover"],
    [{ body: "SUV", engine: "4.5 л", make: "Toyota", model: "Land Cruiser 200" }, "suv"],
    [{ body: "SUV", engine: "2.7 л", make: "УАЗ", model: "Патриот" }, "offroad"],
    [{ body: "вездеход закрытый", engine: "1.7 л", make: "Lada", model: "Niva" }, "offroad"],
    [{ body: "Пикап", engine: "2.8 л", make: "Toyota", model: "Hilux" }, "pickup"],
    [{ body: "вэн", engine: "2.4 л", make: "Toyota", model: "Estima" }, "minivan"],
    [{ body: "Автофургон / микроавтобус", engine: "2.7 л", make: "Toyota", model: "Hiace" }, "van"],
    [{ body: "Фургон/хетчбэк", engine: "1.6 л", make: "Lada", model: "Largus" }, "compact-van"],
    [{ body: "Фургон", engine: "1.6 л", make: "Ford", model: "Transit Connect" }, "compact-van"],
    [{ body: "c бортовой платформой/ходовая часть", engine: "2.9 л", make: "ГАЗ", model: "ГАЗель Next" }, "truck"],
    [{ body: "Пикап", engine: "5.6 л", make: "Nissan", model: "Titan" }, "pickup"],
    [{ body: "Автобус", engine: "4.2 л", make: "Toyota", model: "Coaster" }, "bus"],
    [{ body: "купе", engine: "2.0 л", make: "Toyota", model: "Celica" }, "coupe"],
    [{ body: "Кабриолет", engine: "1.8 л", make: "Mazda", model: "MX-5" }, "cabrio"],
    [{ body: "Хэтчбэк", fuel: "электро", make: "Nissan", model: "Leaf" }, "electric"],
    [{ body: "седан", engine: "1.6 л", make: "Toyota", model: "Sprinter" }, "sedan-compact"],
  ])("%o → %s", (car, look) => {
    expect(carLook(car)).toBe(look);
  });

  it("falls back to the hatchback without a car or a body type", () => {
    expect(carLook(null)).toBe("hatch");
    expect(carLook({ make: "Toyota", model: "Неизвестная" })).toBe("hatch");
  });

  it("names every look once", () => {
    expect(new Set(CAR_LOOKS).size).toBe(CAR_LOOKS.length);
  });
});
