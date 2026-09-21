import {
  defaultSiteSchedule,
  formatHoursText,
  normalizeSiteSchedule,
  type SiteSchedule,
} from "@art/shared";
import { getSetting, setSetting } from "./db.js";

export const SITE_SCHEDULE_KEY = "site_schedule";

export function getSiteSchedule(): SiteSchedule {
  const raw = getSetting(SITE_SCHEDULE_KEY);
  if (!raw) return defaultSiteSchedule();
  try {
    return normalizeSiteSchedule(JSON.parse(raw));
  } catch {
    return defaultSiteSchedule();
  }
}

export function setSiteSchedule(schedule: SiteSchedule): SiteSchedule {
  const next = normalizeSiteSchedule(schedule);
  setSetting(SITE_SCHEDULE_KEY, JSON.stringify(next));
  setSetting("pwa_site_hours", formatHoursText(next));
  return next;
}

export function ensureSiteScheduleDefault() {
  if (!getSetting(SITE_SCHEDULE_KEY)) {
    setSiteSchedule(defaultSiteSchedule());
  }
}
