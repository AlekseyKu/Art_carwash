import { useEffect, useState } from "react";
import { apiClient, type CatalogSnapshot } from "../api";
import { PageHeader } from "../components/layout/PageHeader";
import { SiteInfoCard } from "../components/price/SiteInfoCard";
import { FormError } from "../components/ui";

export function HomePage() {
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .catalog()
      .then(setCatalog)
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить"));
  }, []);

  if (error) {
    return (
      <div>
        <PageHeader title="Автомойка у ЖД" />
        <FormError message={error} />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div>
        <PageHeader title="Автомойка у ЖД" />
        <p className="price-loading">Загрузка…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Автомойка у ЖД" subtitle="Контакты и как добраться" />
      <SiteInfoCard site={catalog.site} />
    </div>
  );
}
