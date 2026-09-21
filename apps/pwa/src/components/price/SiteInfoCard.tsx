import { SITE_SCHEDULE_WEEKDAY_LABELS_SHORT } from "@art/shared";
import type { CatalogSnapshot } from "../../api";
import { openRoute } from "../../api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export interface SiteInfoCardProps {
  site: CatalogSnapshot["site"];
}

export function SiteInfoCard({ site }: SiteInfoCardProps) {
  const days = site.schedule?.days;
  const showDayList = Array.isArray(days) && days.length === 7;

  return (
    <Card className="site-info">
      <h2 className="ui-title-sm">О мойке</h2>
      <p className="site-info__name">{site.name}</p>
      <p className="site-info__meta">{site.city}</p>
      {/* Пока совпадает с city — не дублируем «г. Ступино»
      {site.addressText && <p className="site-info__meta">{site.addressText}</p>}
      */}
      <p className="site-info__meta">{site.hoursText}</p>
      {showDayList && (
        <ul className="site-info__hours-list">
          {days.map((d) => (
            <li key={d.weekday}>
              <span>{SITE_SCHEDULE_WEEKDAY_LABELS_SHORT[d.weekday - 1]}</span>
              <span>{d.closed ? "выходной" : `${d.open}–${d.close}`}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="site-info__actions">
        <a className="ui-btn ui-btn--secondary" href={`tel:${site.phone}`}>
          Позвонить
        </a>
        <Button type="button" onClick={() => openRoute(site.lat, site.lon)}>
          Построить маршрут
        </Button>
      </div>
    </Card>
  );
}
