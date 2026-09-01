import type { CatalogSnapshot } from "../../api";
import { openRoute } from "../../api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export interface SiteInfoCardProps {
  site: CatalogSnapshot["site"];
}

export function SiteInfoCard({ site }: SiteInfoCardProps) {
  return (
    <Card className="site-info">
      <h2 className="ui-title-sm">О мойке</h2>
      <p className="site-info__name">{site.name}</p>
      <p className="site-info__meta">{site.city}</p>
      {site.addressText && <p className="site-info__meta">{site.addressText}</p>}
      <p className="site-info__meta">{site.hoursText}</p>
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
