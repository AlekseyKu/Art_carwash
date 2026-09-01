import { LOGO_NAV_PATH } from "../../brand/logo";

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <img
      src={LOGO_NAV_PATH}
      alt=""
      className={["brand-logo", className].filter(Boolean).join(" ")}
      aria-hidden
    />
  );
}
