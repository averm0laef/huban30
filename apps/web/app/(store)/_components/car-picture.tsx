/**
 * Our small blue car (Codex, in the style of the catalogue's section pictures, 25.11.2026) where the site shows the
 * customer's car as a picture: «Подойдёт к вашему автомобилю?» on a product (the header uses `CarLineIcon` below).
 * Decoration only — the car's name is always written next to it.
 */
export function CarPicture({ className, height = 24, width = 36 }: { className?: string; height?: number; width?: number }) {
  return (
    <img alt="" aria-hidden="true" className={className} decoding="async" height={height}
      src="/brand/car-mini@2x.webp" srcSet="/brand/car-mini@2x.webp 2x, /brand/car-mini@3x.webp 3x" width={width} />
  );
}

/**
 * The same car as a line icon, for the header's «Моя машина» and the phone menu: it stands among the Fluent «24 Regular»
 * icons (cart, person, location), so it keeps their 1.5 px line and rounded ends (Codex, 25.11.2026: the side view the owner
 * picked over the front and three-quarter ones). Grey until a car is chosen, brand blue after — the header styles `svg` there.
 */
export function CarLineIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
      strokeWidth="1.5" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.75 17.75h-.25a.75.75 0 0 1-.75-.75v-5.25l1.1-4.1A2.9 2.9 0 0 1 6.65 5.5h4.95c1 0 1.85.45 2.45 1.25l3.2 4.5 2.5.5c.9.18 1.5.95 1.5 1.85v2.65c0 .83-.67 1.5-1.5 1.5h-.25m-10.75 0h6.5" />
      <path d="m5 11.25.75-3h5.65c.4 0 .73.17.97.5l1.75 2.5H5Zm4.5-3v3m9.75 2.75h1.75" />
      <circle cx="6.25" cy="17.75" r="2.5" />
      <circle cx="17.75" cy="17.75" r="2.5" />
      <circle cx="6.25" cy="17.75" fill="currentColor" r=".75" stroke="none" />
      <circle cx="17.75" cy="17.75" fill="currentColor" r=".75" stroke="none" />
    </svg>
  );
}
