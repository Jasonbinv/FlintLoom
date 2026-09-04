export type Theme = "light" | "dark" | "warm";

const STORAGE_KEY = "flintloom.theme";
const THEMES: Theme[] = ["light", "dark", "warm"];

export const THEME_LABELS: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  warm: "暖色",
};

export const THEME_ICONS: Record<Theme, string> = {
  light: "☀",
  dark: "🌙",
  warm: "🔥",
};

export function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "warm") {
    return stored;
  }
  return "light";
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function nextTheme(current: Theme): Theme {
  const index = THEMES.indexOf(current);
  return THEMES[(index + 1) % THEMES.length]!;
}
