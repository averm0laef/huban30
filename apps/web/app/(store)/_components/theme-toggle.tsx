"use client";

import { useState } from "react";

type Theme = "dark" | "light" | "system";

const labels: Record<Theme, string> = {
  dark: "Тёмная тема",
  light: "Светлая тема",
  system: "Системная тема",
};

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function toggleTheme(): void {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    const root = document.querySelector<HTMLElement>("[data-storefront-root]");
    if (root) root.dataset.theme = next;
    document.cookie = `an30_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <button className="storefront-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Тема: ${labels[theme]}. Изменить`}>
      {labels[theme]}
    </button>
  );
}
