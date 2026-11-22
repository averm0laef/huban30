/**
 * What a tyre's size says about the tyre, when its name does not say
 * «легковая» or «грузовая».
 *
 * The shop files tyres by the rim (its own 1С groups: «05. А/шина легковая»
 * R13–R19, «03. А/шина грузовая»): a metric size on a whole-inch rim
 * («205/70R15», «195R15C») is a car tyre, a «,5» rim («315/70R22,5»), a very
 * wide tyre («425/85R21») and an inch size («10.00-20», «12.00R20») are truck
 * tyres. Small inch sizes («5,00-12», «2,75-17») are tractor and motorcycle
 * tyres and are left to the name.
 */

/** «205/70R15», «385/65/22,5», «185/75 R16C»: width / profile, then the rim. */
const METRIC_SIZE = /(?<![\d/.,])(\d{3})\s*\/\s*(\d{2})\s*\/?\s*[rр]?\s*-?\s*(\d{2})([.,]5)?(?!\d)/u;
/** «195R15C»: a full-profile tyre, written without the profile. */
const METRIC_SIZE_WITHOUT_PROFILE = /(?<![\d/.,])(\d{3})\s*[rр]\s*(\d{2})([.,]5)?(?!\d)/u;
/** «10.00-20», «12.00R20», «7.00 R16»: width in inches with two decimals, then the rim. */
const INCH_SIZE = /(?<![\d/.,])(\d{1,2})[.,](\d{2})\s*[-rр]\s*(\d{2})(?!\d)/u;

const CAR = "shiny-legkovye";
const TRUCK = "shiny-gruzovye";

/** A truck tyre is at least this wide (mm) whatever its rim: «425/85R21». */
const TRUCK_WIDTH_MM = 385;
/** An inch-sized tyre is a truck tyre from this width and rim up: «7.00R16», «8.25R20». */
const TRUCK_INCH_WIDTH = 6.5;
const TRUCK_INCH_RIM = 16;

function byMetric(width: number, rim: number, halfInchRim: boolean): string | null {
  if (width < 125 || width > 455 || rim < 12 || rim > 24) return null;
  return halfInchRim || width >= TRUCK_WIDTH_MM ? TRUCK : CAR;
}

/** «shiny-legkovye» or «shiny-gruzovye» for the first tyre size in the name; null when it has none or the size does not tell. */
export function tyreKindBySize(name: string): string | null {
  const text = name.toLowerCase();
  const metric = METRIC_SIZE.exec(text);
  if (metric) {
    const profile = Number(metric[2]);
    return profile >= 25 && profile <= 95 ? byMetric(Number(metric[1]), Number(metric[3]), metric[4] !== undefined) : null;
  }
  const bare = METRIC_SIZE_WITHOUT_PROFILE.exec(text);
  if (bare) return byMetric(Number(bare[1]), Number(bare[2]), bare[3] !== undefined);
  const inch = INCH_SIZE.exec(text);
  if (inch) return Number(`${inch[1]}.${inch[2]}`) >= TRUCK_INCH_WIDTH && Number(inch[3]) >= TRUCK_INCH_RIM ? TRUCK : null;
  return null;
}
