import type { ReactNode } from "react";

export interface InfoRowProps {
  label: string;
  value: ReactNode;
}

export function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="info-row">
      <div className="info-row__label">{label}</div>
      <div className="info-row__value">{value}</div>
    </div>
  );
}
