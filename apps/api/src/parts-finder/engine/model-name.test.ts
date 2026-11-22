import { describe, expect, it } from "vitest";

import { parseModelName } from "./model-name.js";

describe("parseModelName", () => {
  it("splits a catalogue name into model, generation and body", () => {
    expect(parseModelName("Caldina Универсал (_T21_)")).toEqual({ body: "универсал", family: "Caldina", generation: "T21" });
    expect(parseModelName("Gaia (_M1_)")).toEqual({ body: null, family: "Gaia", generation: "M1" });
    expect(parseModelName("Cefiro II Седан (A32)")).toEqual({ body: "седан", family: "Cefiro", generation: "II · A32" });
    expect(parseModelName("Noah/Voxy (_R6_)")).toEqual({ body: null, family: "Noah/Voxy", generation: "R6" });
    expect(parseModelName("Stepwgn (E-RF_, GF-RF_)")).toEqual({ body: null, family: "Stepwgn", generation: "E-RF, GF-RF" });
    expect(parseModelName("Jimny Вездеход Закрытый (SJ, JA, JB)")).toEqual({ body: "вездеход закрытый", family: "Jimny", generation: "SJ, JA, JB" });
  });

  it("keeps names that contain a numeral or several words whole when they are known", () => {
    const known = ["Mark II", "Land Cruiser", "Land Cruiser Prado"];
    expect(parseModelName("Mark II IX Седан (_X11_)", known)).toEqual({ body: "седан", family: "Mark II", generation: "IX · X11" });
    expect(parseModelName("Land Cruiser Prado (_J12_)", known)).toEqual({ body: null, family: "Land Cruiser Prado", generation: "J12" });
    expect(parseModelName("Land Cruiser 200 (_J2_)", known)).toEqual({ body: null, family: "Land Cruiser", generation: "200 · J2" });
  });

  it("handles a seed model without any code", () => {
    expect(parseModelName("Probox")).toEqual({ body: null, family: "Probox", generation: null });
    expect(parseModelName("Delica D5 (CV_W)")).toEqual({ body: null, family: "Delica D5", generation: "CVW" });
  });
});
