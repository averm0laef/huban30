"use client";

import { useId, useState } from "react";

import { CUSTOMER_AVATAR_KEYS, customerAvatarSrc, type CustomerAvatarKey } from "../_lib/customer-avatars";
import styles from "./avatar-picker.module.css";

/**
 * Picture for the customer's profile and chat, one of the shop's 15. Native
 * radio buttons give keyboard support for free: Tab enters the grid, arrow
 * keys move, Space selects. Nothing is saved until «Сохранить картинку».
 */
export function AvatarPicker({
  chosen,
  current,
  disabled,
  onSave,
  pending,
}: {
  chosen: boolean;
  current: CustomerAvatarKey;
  disabled: boolean;
  onSave: (key: CustomerAvatarKey | null) => void;
  pending: boolean;
}) {
  const [selected, setSelected] = useState<CustomerAvatarKey>(current);
  const name = useId();
  const changed = selected !== current;
  return (
    <fieldset className={styles.picker} disabled={disabled || pending}>
      <legend>Картинка профиля</legend>
      <p className={styles.hint}>Её видит менеджер в чате. {chosen ? "" : "Сейчас выбрана автоматически."}</p>
      <div className={styles.grid}>
        {CUSTOMER_AVATAR_KEYS.map((key, index) => (
          <label className={styles.option} key={key} data-current={key === current || undefined}>
            <input
              checked={selected === key}
              className={styles.radio}
              name={name}
              onChange={() => setSelected(key)}
              type="radio"
              value={key}
            />
            <img alt={`Картинка ${index + 1}${key === current ? ", текущая" : ""}`} height={56} src={customerAvatarSrc(key)} width={56} />
            {key === current ? <span className={styles.currentMark} aria-hidden="true">✓</span> : null}
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button className={styles.save} disabled={!changed || pending} onClick={() => onSave(selected)} type="button">
          {pending ? "Сохраняем…" : "Сохранить картинку"}
        </button>
        {chosen && !changed ? (
          <button className={styles.reset} disabled={pending} onClick={() => onSave(null)} type="button">Выбирать автоматически</button>
        ) : null}
        {changed ? <button className={styles.reset} onClick={() => setSelected(current)} type="button">Отменить выбор</button> : null}
      </div>
    </fieldset>
  );
}
