import { BrandWheel } from "./brand-mark";
import styles from "./wheel-loader.module.css";

/**
 * «Ищем…»: the wheel of the logo turning while a request is on its way — the same wheel that stands for the «0» of
 * the 404 page (Claude Design canvas «совместимость и аналоги», «Фото из каталога»). With reduced motion the wheel
 * stands still and the words say the same.
 */
export function WheelLoader({ label, size = "md" }: { label: string; size?: "sm" | "md" }) {
  return (
    <span className={styles.loader} data-size={size} role="status">
      <BrandWheel className={styles.wheel} />
      <span>{label}</span>
    </span>
  );
}
