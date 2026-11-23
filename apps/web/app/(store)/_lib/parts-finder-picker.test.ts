import { describe, expect, it } from "vitest";

import { vehicleRows } from "./parts-finder";

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
