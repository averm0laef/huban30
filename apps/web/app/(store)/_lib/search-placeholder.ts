/**
 * Examples the header search types into its placeholder, one after another:
 * a VIN, a part number or a part name, and every fourth one the plain hint.
 */
export const SEARCH_HINT = "Введите VIN, артикул или название";

const EXAMPLES: readonly string[] = [
  "Артикул 04152-40060",
  "Масло 5W-40 4 л",
  "VIN XTAGFK330JY144213",
  "Колодки Лада Веста",
  "Артикул W 914/2",
  "Щётка стеклоочистителя 600 мм",
  "VIN 1HGCM82633A004352",
  "Аккумулятор 60 Ач",
  "Артикул GDB3332",
  "Фильтр салонный Kia Rio",
  "Номер кузова NCP160-0012345",
  "Антифриз G12 красный",
  "Артикул 0 986 494 104",
  "Свечи зажигания NGK",
  "VIN Z94CB41AAER123456",
  "Тормозная жидкость DOT-4",
  "Артикул 90915-YZZE1",
  "Лампа H7 12V",
  "Фильтр масляный Toyota Camry",
  "Артикул BKR6E",
  "Незамерзайка −20",
  "Амортизатор Hyundai Solaris",
];

/** The typing order: three examples, then the hint, round and round. */
export function placeholderSequence(examples: readonly string[] = EXAMPLES): string[] {
  const out: string[] = [];
  examples.forEach((example, index) => {
    out.push(example);
    if (index % 3 === 2) out.push(SEARCH_HINT);
  });
  if (out.at(-1) !== SEARCH_HINT) out.push(SEARCH_HINT);
  return out;
}

export interface TypingFrame { text: string; delay: number }

/** Every frame of typing one line, holding it, then erasing it. */
export function typingFrames(line: string, speed = { erase: 22, hold: 1700, type: 55 }): TypingFrame[] {
  const chars = [...line];
  const frames: TypingFrame[] = [];
  for (let length = 1; length <= chars.length; length += 1) frames.push({ delay: speed.type, text: chars.slice(0, length).join("") });
  frames.push({ delay: speed.hold, text: line });
  for (let length = chars.length - 1; length >= 0; length -= 1) frames.push({ delay: speed.erase, text: chars.slice(0, length).join("") });
  return frames;
}
