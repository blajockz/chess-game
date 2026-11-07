import type { Ban } from "./guest";

export function isPermanent(ban: Ban) {
  return new Date(ban.until).getFullYear() >= 9999;
}

export function span(ms: number) {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "less than a minute";
  const days = Math.floor(min / 1440);
  const hours = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}` + (hours ? ` ${hours} h` : "");
  if (hours > 0) return `${hours} h` + (mins ? ` ${mins} min` : "");
  return `${mins} min`;
}

export function banLength(ban: Ban) {
  if (isPermanent(ban)) return "Permanent";
  if (!ban.since) return null;
  const ms = Date.parse(ban.until) - Date.parse(ban.since);
  return Number.isFinite(ms) && ms > 0 ? span(Math.round(ms / 60_000) * 60_000) : null;
}

export function endDate(ban: Ban) {
  return new Date(ban.until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function banEnds(ban: Ban) {
  return isPermanent(ban) ? "permanently" : `until ${endDate(ban)}`;
}
