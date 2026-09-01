import { useEffect, useMemo, useState } from "react";
import { apiClient, type CatalogSnapshot } from "../api";
import { PriceLabel } from "../components/AppShell";
import { PageHeader } from "../components/layout/PageHeader";
import { CatalogEmpty } from "../components/price/CatalogEmpty";
import { SiteInfoCard } from "../components/price/SiteInfoCard";
import { Card, ClassTabs, FormError, ListRow } from "../components/ui";

const CLASS_PRICED_SLUGS = new Set(["services", "extra-services"]);

function resolvePrice(
  serviceId: string,
  classId: string,
  catalog: CatalogSnapshot,
  tabSlug: string
): number | null {
  if (CLASS_PRICED_SLUGS.has(tabSlug)) {
    const row = catalog.servicePrices.find(
      (p) => p.serviceId === serviceId && p.classId === classId
    );
    return row?.priceKopecks ?? null;
  }
  const svc = catalog.services.find((s) => s.id === serviceId);
  return svc?.priceKopecks ?? null;
}

function hasCatalogItems(catalog: CatalogSnapshot, classId: string): boolean {
  const tabs = catalog.tabs.filter((t) => t.active);
  return tabs.some((tab) =>
    catalog.services
      .filter((s) => s.active && s.tabId === tab.id)
      .some((s) => resolvePrice(s.id, classId, catalog, tab.slug) !== null)
  );
}

export function PricePage() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState("");
  const [classId, setClassId] = useState("");

  useEffect(() => {
    apiClient
      .catalog()
      .then((c) => {
        setCatalog(c);
        const first = c.vehicleClasses.find((v) => v.active);
        if (first) setClassId(first.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить прайс"));
  }, []);

  const tabs = useMemo(
    () => (catalog?.tabs.filter((t) => t.active) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    [catalog]
  );

  if (error) {
    return (
      <>
        <PageHeader title="Прайс" />
        <FormError message={error} />
      </>
    );
  }

  if (!catalog) {
    return (
      <>
        <PageHeader title="Прайс" />
        <p className="price-loading">Загрузка прайса…</p>
      </>
    );
  }

  const classes = catalog.vehicleClasses
    .filter((c) => c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const catalogEmpty = !classes.length || !classId || !hasCatalogItems(catalog, classId);

  return (
    <div>
      <PageHeader title="Прайс" subtitle="Актуальные цены по классу автомобиля" />

      <ClassTabs
        items={classes.map((vc) => ({ id: vc.id, name: vc.name, iconKey: vc.iconKey }))}
        value={classId}
        onChange={setClassId}
      />

      {catalogEmpty ? (
        <CatalogEmpty />
      ) : (
        tabs.map((tab) => {
          const items = catalog.services
            .filter((s) => s.active && s.tabId === tab.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({
              service: s,
              price: resolvePrice(s.id, classId, catalog, tab.slug),
            }))
            .filter((x) => x.price !== null);

          if (!items.length) return null;

          return (
            <Card key={tab.id} className="price-section">
              <h2 className="ui-title-sm">{tab.name}</h2>
              {items.map(({ service, price }) => (
                <ListRow
                  key={service.id}
                  title={service.name}
                  description={service.description || undefined}
                  price={<PriceLabel kopecks={price!} />}
                />
              ))}
            </Card>
          );
        })
      )}

      <SiteInfoCard site={catalog.site} />
    </div>
  );
}
