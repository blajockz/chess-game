export type ThemeId = "classic" | "rain" | "snow" | "autumn" | "storm" | "golden";

export type Weather = "none" | "rain" | "storm" | "snow" | "leaves" | "motes";

export type Theme = {
  id: ThemeId;
  name: string;
  blurb: string;
  icon: string;
  weather: Weather;
  sky: string;
  squares: [string, string];
};

export const THEMES: Theme[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "Calm walnut, no weather",
    icon: "♞",
    weather: "none",
    sky: "linear-gradient(180deg, #171713 0%, #121210 60%)",
    squares: ["#A89C82", "#6A6151"],
  },
  {
    id: "rain",
    name: "Rain",
    blurb: "Steady rain on slate",
    icon: "☂",
    weather: "rain",
    sky: "linear-gradient(180deg, #1C2530 0%, #11171E 55%, #0C1014 100%)",
    squares: ["#8E9EB4", "#4E637F"],
  },
  {
    id: "snow",
    name: "Snow",
    blurb: "Quiet snowfall, frosted stone",
    icon: "❄",
    weather: "snow",
    sky:
      "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(210, 228, 235, 0.10) 0%, transparent 70%), linear-gradient(180deg, #1F2729 0%, #151A1B 55%, #101314 100%)",
    squares: ["#90A0A2", "#526668"],
  },
  {
    id: "autumn",
    name: "Autumn",
    blurb: "Falling leaves, warm oak",
    icon: "🍂",
    weather: "leaves",
    sky: "linear-gradient(180deg, #2A1D14 0%, #18110C 55%, #120D0A 100%)",
    squares: ["#B7977A", "#7E5A3B"],
  },
  {
    id: "storm",
    name: "Storm",
    blurb: "Heavy rain and lightning",
    icon: "⚡",
    weather: "storm",
    sky:
      "radial-gradient(ellipse 90% 60% at 50% -10%, #272B47 0%, #13141F 60%, #0B0B12 100%)",
    squares: ["#9A9CB1", "#5D5F80"],
  },
  {
    id: "golden",
    name: "Golden hour",
    blurb: "Low sun, drifting dust",
    icon: "☀",
    weather: "motes",
    sky:
      "radial-gradient(ellipse 70% 55% at 85% 0%, rgba(240, 168, 88, 0.30) 0%, transparent 70%), linear-gradient(180deg, #2B1F14 0%, #18120C 55%, #120E0A 100%)",
    squares: ["#B89869", "#785D36"],
  },
];

export const DEFAULT_THEME: ThemeId = "classic";

const STORAGE_KEY = "tempo.theme";

export function themeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved as ThemeId;
  } catch {
  }
  return DEFAULT_THEME;
}

export function saveTheme(id: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
  }
}