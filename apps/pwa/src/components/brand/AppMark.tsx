import { LOGO_NAV_SRC } from "../../brand/logo";

export function AppMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={["app-mark", className].filter(Boolean).join(" ")}
      style={{
        WebkitMaskImage: `url(${LOGO_NAV_SRC})`,
        maskImage: `url(${LOGO_NAV_SRC})`,
      }}
      aria-hidden
    />
  );
}
