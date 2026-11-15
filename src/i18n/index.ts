import fr from "./fr";
import ar from "./ar";
import es from "./es";
import pt from "./pt";
import ary from "./ary";

export type Lang = "en" | "fr" | "ar" | "ary" | "es" | "pt";

export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "fr", name: "Français" },
  { id: "ar", name: "العربية" },
  { id: "ary", name: "الدارجة" },
  { id: "es", name: "Español" },
  { id: "pt", name: "Português" },
];

const KEY = "tempo.lang";
const DICTS: Record<Lang, Record<string, string>> = { en: {}, fr, ar, ary, es, pt };

const isLang = (v: unknown): v is Lang => typeof v === "string" && v in DICTS;

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
  }
  if (typeof navigator !== "undefined") {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = String(tag ?? "").slice(0, 2).toLowerCase();
      if (isLang(base)) return base;
    }
  }
  return "en";
}

export const LANG: Lang = detect();
export const RTL = LANG === "ar" || LANG === "ary";
const dict = DICTS[LANG];

if (typeof document !== "undefined") {
  document.documentElement.lang = LANG;
  document.documentElement.dir = RTL ? "rtl" : "ltr";
}

type Vars = Record<string, string | number | null | undefined>;

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name] ?? "") : all));
}

export function t(english: string, vars?: Vars): string {
  return fill(dict[english] ?? english, vars);
}

let patterns: { re: RegExp; names: string[]; text: string }[] | null = null;

export function translateMessage(message: string | null | undefined): string {
  const msg = String(message ?? "");
  if (!msg || LANG === "en") return msg;
  if (dict[msg]) return dict[msg];
  if (!patterns) {
    patterns = [];
    for (const [english, text] of Object.entries(dict)) {
      if (!english.includes("{")) continue;
      const names: string[] = [];
      const source = english
        .split(/(\{\w+\})/)
        .map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (m) {
            names.push(m[1]);
            return "(.+?)";
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      patterns.push({ re: new RegExp("^" + source + "$"), names, text });
    }
  }
  for (const p of patterns) {
    const m = p.re.exec(msg);
    if (m) return fill(p.text, Object.fromEntries(p.names.map((n, i) => [n, dict[m[i + 1]] ?? m[i + 1]])));
  }
  return msg;
}

export function setLang(lang: Lang) {
  if (lang === LANG) return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
  }
  window.location.reload();
}