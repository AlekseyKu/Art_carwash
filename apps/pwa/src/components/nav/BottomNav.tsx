import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { BrandLogo } from "../brand/BrandLogo";
import { ExpandingLabel } from "./ExpandingLabel";

interface NavTab {
  to: string;
  label: string;
  icon: ReactNode;
}

const tabs: NavTab[] = [
  {
    to: "/app/price",
    label: "Прайс",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/app/booking",
    label: "Запись",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: "/app/cabinet",
    label: "Кабинет",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
      </svg>
    ),
  },
];

function NavSegment({ tab }: { tab: NavTab }) {
  return (
    <NavLink
      to={tab.to}
      end
      className={({ isActive }) =>
        ["bottom-nav__segment", isActive ? "bottom-nav__segment--active" : ""]
          .filter(Boolean)
          .join(" ")
      }
      aria-label={tab.label}
    >
      {({ isActive }) => (
        <>
          <span className="bottom-nav__icon">{tab.icon}</span>
          <ExpandingLabel label={tab.label} expanded={isActive} />
        </>
      )}
    </NavLink>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const logoActive = pathname === "/app/price" || pathname === "/app";

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <div className="bottom-nav__bar">
        <NavLink
          to="/app/price"
          end
          className={["bottom-nav__logo", logoActive ? "bottom-nav__logo--active" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-label="Автомойка у ЖД"
        >
          <BrandLogo />
        </NavLink>

        <div className="bottom-nav__tabs">
          <div className="bottom-nav__cluster">
            {tabs.map((tab, index) => (
              <div key={tab.to} className="bottom-nav__segment-wrap">
                {index > 0 && <span className="bottom-nav__spacer" aria-hidden />}
                <NavSegment tab={tab} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
