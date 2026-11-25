/**
 * Our small blue car (Codex, in the style of the catalogue's section pictures, 25.11.2026) where the site shows the
 * customer's car: the header's «Моя машина», the phone's menu and «Подойдёт к вашему автомобилю?» on a product.
 * Decoration only — the car's name is always written next to it.
 */
export function CarPicture({ className, height = 24, width = 36 }: { className?: string; height?: number; width?: number }) {
  return (
    <img alt="" aria-hidden="true" className={className} decoding="async" height={height}
      src="/brand/car-mini@2x.webp" srcSet="/brand/car-mini@2x.webp 2x, /brand/car-mini@3x.webp 3x" width={width} />
  );
}
