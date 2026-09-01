import { Card } from "../ui/Card";

export interface CatalogEmptyProps {
  title?: string;
  message?: string;
}

export function CatalogEmpty({
  title = "Прайс пока пуст",
  message = "Каталог ещё не опубликован с кассы. Загляните позже или позвоните на мойку.",
}: CatalogEmptyProps) {
  return (
    <Card className="catalog-empty">
      <p className="catalog-empty__title">{title}</p>
      <p className="catalog-empty__text">{message}</p>
    </Card>
  );
}
