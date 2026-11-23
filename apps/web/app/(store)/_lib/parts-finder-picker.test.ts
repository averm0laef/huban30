import { describe, expect, it } from "vitest";

import { isRepeatClick, pickerStep, vehicleRows } from "./parts-finder";

const toyota = { id: 2, name: "Toyota", slug: "toyota" };
const allion = { id: 33, name: "Allion" };

describe("which step the make and model picker of /podbor shows", () => {
  it("walks make, model, generation, engine as the choices are made", () => {
    expect(pickerStep({ family: null, make: null, model: null })).toBe(1);
    expect(pickerStep({ family: null, make: toyota, model: null })).toBe(2);
    expect(pickerStep({ family: "Allion", make: toyota, model: null })).toBe(3);
    expect(pickerStep({ family: "Allion", make: toyota, model: allion })).toBe(4);
  });

  // The «Toyota» breadcrumb cleared the make and the model but not the model family: the picker stood on
  // «Поколение» with nothing under it, and only closing it helped.
  it("goes back to the list of makes when the make is gone, whatever was chosen under it", () => {
    expect(pickerStep({ family: "Allion", make: null, model: null })).toBe(1);
    expect(pickerStep({ family: "Allion", make: null, model: allion })).toBe(1);
  });
});

describe("a double click in the picker", () => {
  // The first click on «Toyota» puts the list of models under the pointer; the second one used to land on
  // «Allion» and open its engines, though the visitor never saw the list.
  it("takes the first click and the keyboard, and drops the second and later clicks of one series", () => {
    expect(isRepeatClick({ detail: 1 })).toBe(false);
    expect(isRepeatClick({ detail: 0 })).toBe(false);
    expect(isRepeatClick({ detail: 2 })).toBe(true);
    expect(isRepeatClick({ detail: 3 })).toBe(true);
  });
});

describe("engine volume in the VIN result", () => {
  const volume = (value: unknown) => vehicleRows({ vehicle: { displacement_l: value } });

  // vPIC converts cubic inches to litres and answers «2.998832712» for a 3.0 engine.
  it("is shown the way a buyer reads it: one decimal, a comma, litres", () => {
    expect(volume("2.998832712")).toEqual([["Объём двигателя", "3,0 л"]]);
    expect(volume(2.998832712)).toEqual([["Объём двигателя", "3,0 л"]]);
    expect(volume("1.6")).toEqual([["Объём двигателя", "1,6 л"]]);
    expect(volume("1,8")).toEqual([["Объём двигателя", "1,8 л"]]);
    expect(volume(2)).toEqual([["Объём двигателя", "2,0 л"]]);
  });

  it("keeps a value that is not a volume as it came and hides an empty one", () => {
    expect(volume("1.5 Turbo")).toEqual([["Объём двигателя", "1.5 Turbo"]]);
    expect(volume("")).toEqual([]);
    expect(volume(0)).toEqual([]);
    expect(volume(null)).toEqual([]);
  });

  it("leaves the other rows untouched", () => {
    expect(vehicleRows({ vehicle: { displacement_l: "2.998832712", engine_hp: "240", make: "HONDA", model_year: 2003 } }))
      .toEqual([["Марка", "HONDA"], ["Модельный год", "2003"], ["Объём двигателя", "3,0 л"], ["Мощность, л. с.", "240"]]);
  });
});
