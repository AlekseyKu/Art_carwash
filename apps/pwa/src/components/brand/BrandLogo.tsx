import { AppMark } from "./AppMark";

export function BrandLogo({ className = "" }: { className?: string }) {
  return <AppMark className={["brand-logo", className].filter(Boolean).join(" ")} />;
}
