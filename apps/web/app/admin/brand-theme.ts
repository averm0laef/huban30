import { createDarkTheme, createLightTheme, type BrandVariants } from "@fluentui/react-components";

// The logo's ultramarine is the primary step; Fluent derives all component
// states from this ramp instead of introducing its default Microsoft blue.
const brand: BrandVariants = {
  10: "#03001c", 20: "#060038", 30: "#090054", 40: "#0c0070",
  50: "#0f008c", 60: "#1200a8", 70: "#1500c4", 80: "#1800e0",
  90: "#3520ed", 100: "#5340f1", 110: "#7160f5", 120: "#9081f7",
  130: "#b0a5fa", 140: "#cdc6fc", 150: "#e5e1fd", 160: "#f5f3ff",
};

const shared = {
  fontFamilyBase: '"Inter Storefront", "Golos Text", system-ui, sans-serif',
  fontFamilyNumeric: '"Inter Storefront", "Golos Text", system-ui, sans-serif',
  fontSizeBase100: "12px",
  lineHeightBase100: "16px",
  borderRadiusMedium: "12px",
  borderRadiusLarge: "18px",
  borderRadiusXLarge: "26px",
};

export const staffLightTheme = { ...createLightTheme(brand), ...shared };
export const staffDarkTheme = { ...createDarkTheme(brand), ...shared };
