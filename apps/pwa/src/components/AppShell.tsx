import { formatRub } from "@art/shared";

export { AppScaffold } from "./layout/AppScaffold";

/** @deprecated Use AppScaffold */
export { AppScaffold as AppShell } from "./layout/AppScaffold";

export function PriceLabel({ kopecks }: { kopecks: number }) {
  return <span>{formatRub(kopecks)}</span>;
}
