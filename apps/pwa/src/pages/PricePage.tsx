import { useEffect, useMemo, useState } from "react";
import { apiClient, openRoute, type CatalogSnapshot } from "../api";
import { PriceLabel } from "../components/AppShell";
import { vehicleClassIconSrc } from "../vehicleClassIcons";

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

export function PricePage() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState("");
  const [classId, setClassId] = useState<string>("");

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

  if (error) return <p className="error-text">{error}</p>;
  if (!catalog) return <p style={{ color: "var(--muted)" }}>Загрузка прайса…</p>;

  const classes = catalog.vehicleClasses.filter((c) => c.active);

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Прайс</h1>

      <div className="price-class-tabs">
        {classes.map((vc) => (
          <button
            key={vc.id}
            type="button"
            className={`price-class-tab ${classId === vc.id ? "active" : ""}`}
            onClick={() => setClassId(vc.id)}
          >
            {vehicleClassIconSrc(vc.iconKey) && (
              <img src={vehicleClassIconSrc(vc.iconKey)} alt="" />
            )}
            {vc.name}
          </button>
        ))}
      </div>

      {tabs.map((tab) => {
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
          <section key={tab.id} className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>{tab.name}</h2>
            {items.map(({ service, price }) => (
              <div key={service.id} className="service-row">
                <div>
                  <div className="service-name">{service.name}</div>
                  {service.description && (
                    <div className="service-desc">{service.description}</div>
                  )}
                </div>
                <div className="service-price">
                  <PriceLabel kopecks={price!} />
                </div>
              </div>
            ))}
          </section>
        );
      })}

      <section className="card site-block">
        <h2>О мойке</h2>
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{catalog.site.name}</p>
        <p style={{ margin: 0, color: "var(--muted)" }}>{catalog.site.city}</p>
        <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>{catalog.site.hoursText}</p>
        <div className="site-actions">
          <a className="btn btn-secondary" href={`tel:${catalog.site.phone}`}>
            Позвонить
          </a>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openRoute(catalog.site.lat, catalog.site.lon)}
          >
            Построить маршрут
          </button>
        </div>
      </section>
    </div>
  );
}
