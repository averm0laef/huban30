export interface Point {
  x: number;
  y: number;
}

/** The left edge of a pane, in the same coordinates as the pointer's positions. */
export interface PaneEdge {
  bottom: number;
  left: number;
  top: number;
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/**
 * True when a pointer that was at `previous` and is now at `current` is heading for a pane on its right: it moved
 * to the right and is inside the triangle between where it was and the two ends of the pane's left edge.
 *
 * A menu with a list on the left and the chosen item's contents on the right uses this to tell «on the way to
 * the contents» from «choosing another item»: the way there crosses other items of the list, and they must not
 * take over while the pointer is plainly passing through.
 */
export function headsForPane(previous: Point, current: Point, pane: PaneEdge): boolean {
  if (current.x <= previous.x) return false;
  const upper = { x: pane.left, y: pane.top };
  const lower = { x: pane.left, y: pane.bottom };
  const sides = [cross(previous, upper, current), cross(upper, lower, current), cross(lower, previous, current)];
  return !(sides.some((side) => side < 0) && sides.some((side) => side > 0));
}

/**
 * What a section of the list does when the pointer is on it while another section is in hand: «wait» while the
 * pointer is heading for the pane, «pick» once it is not.
 *
 * `trail` is the pointer's last positions, oldest first. `waitedAt` is where the pointer was when this same
 * section last decided to wait, or null when the pointer has only just come onto it. A pointer found where it
 * waited has stopped, and the section takes over. Arriving is never «standing still»: a browser reports the
 * arrival before the movement itself, so on arrival the trail still ends where the pointer was a moment ago —
 * on the section it has just left.
 */
export function aimVerdict(trail: readonly Point[], pane: PaneEdge, waitedAt: Point | null): "pick" | "wait" {
  const previous = trail[0];
  const current = trail.at(-1);
  if (!previous || !current) return "pick";
  if (waitedAt && waitedAt.x === current.x && waitedAt.y === current.y) return "pick";
  return headsForPane(previous, current, pane) ? "wait" : "pick";
}
