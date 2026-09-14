/** Слоты записи: Europe/Moscow, окно 09:00–21:00, шаг 15 мин. */

export const BOOKING_TZ = "Europe/Moscow";
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 21;
export const SLOT_STEP_MINUTES = 15;
export const LINE_POST_ID = 1;

const OCCUPYING = new Set(["booked", "arrived", "in_service"]);

export function isOccupyingStatus(status: string): boolean {
  return OCCUPYING.has(status);
}

export function mskDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function mskParts(d = new Date()): { hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BOOKING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function mskWallToUtcIso(date: string, hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${date}T${pad(hour)}:${pad(minute)}:00+03:00`).toISOString();
}

export function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Округление вниз до шага сетки слотов (MSK). */
export function roundDownToSlotIso(iso: string): string {
  const { date, hour, minute } = mskParts(new Date(iso));
  const rounded = Math.floor(minute / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES;
  return mskWallToUtcIso(date, hour, rounded);
}

export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type BusyInterval = { startsAt: string; endsAt: string };

export function candidateStarts(date: string, durationMinutes: number): string[] {
  if (durationMinutes <= 0) return [];
  const out: string[] = [];
  const dayOpen = mskWallToUtcIso(date, OPEN_HOUR, 0);
  const dayClose = mskWallToUtcIso(date, CLOSE_HOUR, 0);
  let cursor = new Date(dayOpen);
  const closeMs = new Date(dayClose).getTime();
  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const durMs = durationMinutes * 60_000;
  while (cursor.getTime() + durMs <= closeMs) {
    out.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return out;
}

export function filterFreeSlots(
  starts: string[],
  durationMinutes: number,
  busy: BusyInterval[],
  notBeforeIso: string | null
): { startsAt: string; endsAt: string }[] {
  const result: { startsAt: string; endsAt: string }[] = [];
  for (const startsAt of starts) {
    if (notBeforeIso && startsAt < notBeforeIso) continue;
    const endsAt = addMinutesIso(startsAt, durationMinutes);
    const clash = busy.some((b) => rangesOverlap(startsAt, endsAt, b.startsAt, b.endsAt));
    if (!clash) result.push({ startsAt, endsAt });
  }
  return result;
}

export function formatMskTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BOOKING_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
