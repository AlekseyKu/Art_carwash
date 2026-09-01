import type { ReactNode } from "react";

export interface ListRowProps {
  title: string;
  description?: string;
  price: ReactNode;
}

export function ListRow({ title, description, price }: ListRowProps) {
  return (
    <div className="list-row">
      <div className="list-row__body">
        <div className="list-row__title">{title}</div>
        {description && <div className="list-row__desc">{description}</div>}
      </div>
      <div className="list-row__price">{price}</div>
    </div>
  );
}
