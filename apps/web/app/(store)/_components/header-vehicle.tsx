"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { chosenCarCaption, readChosenCar, type PickedVehicle } from "../_lib/parts-finder";
import { activeCar, onActiveCarChange, signedIn } from "../_lib/tecdoc";

/** Set once the garage has been asked for its main car, so the header does not ask again on every page. */
const GARAGE_CHECKED_KEY = "an30:garage-car-checked";

// The chosen car lives in this browser's storage. The snapshot is a string so that an unchanged car is an
// unchanged value; on the server there is no car.
const snapshot = (): string => JSON.stringify(readChosenCar());
const serverSnapshot = (): string => "null";

/** The car this browser shops for, kept in step with /podbor and with other tabs. */
export function useChosenCar(): PickedVehicle | null {
  const raw = useSyncExternalStore(onActiveCarChange, snapshot, serverSnapshot);

  useEffect(() => {
    // A signed-in customer who picked no car on this device shops for the main car of the garage. The header is on
    // every page, so the garage is asked once per browser session, not once per page.
    if (raw !== "null" || !signedIn()) return;
    try {
      if (window.sessionStorage.getItem(GARAGE_CHECKED_KEY)) return;
      window.sessionStorage.setItem(GARAGE_CHECKED_KEY, "1");
    } catch {
      return;
    }
    // activeCar() stores the garage's main car, and storing it tells this hook.
    void activeCar();
  }, [raw]);

  return useMemo(() => JSON.parse(raw) as PickedVehicle | null, [raw]);
}

/**
 * The chosen car among the header's actions, next to the cart: which car the shop picks parts for, on every page.
 * The place is there with or without a car — the car is known only after the browser's storage is read, and an
 * action that appeared then would push the search field aside on every page load.
 */
export function HeaderVehicle({ icon }: { icon?: ReactNode }) {
  const car = useChosenCar();
  const pathname = usePathname();
  const { caption, description } = chosenCarCaption(car);
  return (
    <Link aria-current={pathname === "/podbor" ? "page" : undefined} aria-label={description} className="storefront-vehicle-button"
      data-chosen={car ? "true" : undefined} href="/podbor" title={description}>
      {icon}
      <span className="storefront-vehicle-label">{caption}</span>
    </Link>
  );
}

/** The same in the phone's drawer, where the header has no room for actions. */
export function DrawerVehicle({ className, icon, onNavigate }: { className?: string; icon?: ReactNode; onNavigate?: () => void }) {
  const car = useChosenCar();
  const { caption } = chosenCarCaption(car);
  return (
    <Link className={className} data-chosen={car ? "true" : undefined} href="/podbor" onClick={onNavigate}>
      {icon}
      <span>
        <strong>{car ? caption : "Выбрать автомобиль"}</strong>
        <small>{car ? "Ваш автомобиль · подбор запчастей" : "Подбор запчастей по марке, модели или VIN"}</small>
      </span>
    </Link>
  );
}
