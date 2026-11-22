"use client";

import { Add20Regular, Delete20Regular, Star20Filled, Star20Regular, VehicleCar20Regular } from "@fluentui/react-icons";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { savePickedVehicle, type PickedVehicle } from "../_lib/parts-finder";
import { errorText } from "../_lib/storefront-api";
import {
  addGarageVehicle, listGarage, makeGarageVehiclePrimary, pickedFromGarage, removeGarageVehicle, vehicleCatalogSource, type GarageVehicle,
} from "../_lib/tecdoc";
import { VehiclePicker } from "../podbor/vehicle-picker";
import buttons from "./store-button.module.css";
import styles from "./garage-panel.module.css";
import shared from "./storefront.module.css";

const MAX_VEHICLES = 10;

/**
 * «Гараж»: the customer's saved cars. The main one is what the site shops
 * for by default: parts search and «подходит вашему автомобилю» on a
 * product page use it on every device the customer signs in on.
 */
export function GaragePanel({ onCount }: { onCount?: (count: number) => void }) {
  const [vehicles, setVehicles] = useState<GarageVehicle[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState<"local" | "tecdoc">("local");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    listGarage()
      .then((list) => { setVehicles(list); onCount?.(list.length); })
      .catch((caught: unknown) => { setVehicles([]); setError(errorText(caught)); });
  }, [onCount]);

  useEffect(() => {
    reload();
    void vehicleCatalogSource().then(setSource);
  }, [reload]);

  async function act(id: string, work: () => Promise<unknown>) {
    setPending(id);
    setError("");
    try {
      await work();
      reload();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setPending(null);
    }
  }

  function add(picked: PickedVehicle) {
    setAdding(false);
    const first = (vehicles?.length ?? 0) === 0;
    void act("add", async () => {
      await addGarageVehicle(picked, first);
      // The first car becomes the one the site shops for on this device as well.
      if (first) savePickedVehicle(picked);
    });
  }

  function makeMain(vehicle: GarageVehicle) {
    void act(vehicle.id, async () => {
      await makeGarageVehiclePrimary(vehicle.id);
      savePickedVehicle(pickedFromGarage(vehicle));
    });
  }

  return (
    <>
      <div className={shared.accountPanelHead}>
        <h2>Гараж</h2>
        {vehicles?.length ? <p>{vehicles.length} из {MAX_VEHICLES}</p> : null}
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {vehicles === null ? <p className={styles.muted} role="status">Загружаем автомобили…</p> : null}

      {vehicles && vehicles.length === 0 && !adding ? (
        <div className={shared.accountEmpty}>
          <h3>В гараже пока нет автомобилей</h3>
          <p>Добавьте свою машину — сайт будет подбирать детали для неё и показывать в карточке товара, подходит ли деталь.</p>
        </div>
      ) : null}

      {vehicles && vehicles.length > 0 ? (
        <ul className={styles.list}>
          {vehicles.map((vehicle) => (
            <li className={styles.car} data-main={vehicle.isPrimary || undefined} key={vehicle.id}>
              <VehicleCar20Regular aria-hidden="true" className={styles.icon} />
              <div className={styles.body}>
                <strong>{vehicle.title}</strong>
                {vehicle.details ? <span>{vehicle.details}</span> : null}
                {vehicle.isPrimary ? <small className={styles.mainBadge}><Star20Filled aria-hidden="true" /> Основной: подбор идёт для него</small> : null}
              </div>
              <div className={styles.actions}>
                {vehicle.isPrimary ? (
                  <Link className={`${buttons.button} ${buttons.soft}`} href="/podbor" onClick={() => savePickedVehicle(pickedFromGarage(vehicle))}>Подобрать детали</Link>
                ) : (
                  <button className={`${buttons.button} ${buttons.quiet}`} disabled={pending !== null} onClick={() => makeMain(vehicle)} type="button">
                    <Star20Regular aria-hidden="true" /> Сделать основным
                  </button>
                )}
                <button aria-label={`Удалить ${vehicle.title} из гаража`} className={styles.remove} disabled={pending !== null}
                  onClick={() => { if (window.confirm(`Удалить ${vehicle.title} из гаража?`)) void act(vehicle.id, () => removeGarageVehicle(vehicle.id)); }} type="button">
                  <Delete20Regular aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <div className={styles.picker}><VehiclePicker onCancel={() => setAdding(false)} onPick={add} source={source} /></div>
      ) : vehicles && vehicles.length < MAX_VEHICLES ? (
        <button className={`${buttons.button} ${buttons.primary} ${styles.add}`} disabled={pending !== null} onClick={() => setAdding(true)} type="button">
          <Add20Regular aria-hidden="true" /> Добавить автомобиль
        </button>
      ) : null}
    </>
  );
}
