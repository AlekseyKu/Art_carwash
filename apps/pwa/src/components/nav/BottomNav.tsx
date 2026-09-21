import type { ComponentType, SVGProps } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  CalendarDaysIcon,
  DocumentTextIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { BrandLogo } from "../brand/BrandLogo";
import { ExpandingLabel } from "./ExpandingLabel";

type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

interface NavTab {
  to: string;
  label: string;
  icon: NavIcon;
}

const tabs: NavTab[] = [
  {
    to: "/app/price",
    label: "Прайс",
    icon: DocumentTextIcon,
  },
  {
    to: "/app/booking",
    label: "Запись",
    icon: CalendarDaysIcon,
  },
  {
    to: "/app/cabinet",
    label: "Кабинет",
    icon: UserIcon,
  },
];

function NavSegment({ tab }: { tab: NavTab }) {
  const Icon = tab.icon;

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
          <span className="bottom-nav__icon">
            <Icon aria-hidden />
          </span>
          <ExpandingLabel label={tab.label} expanded={isActive} />
        </>
      )}
    </NavLink>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const logoActive = pathname === "/app/home" || pathname === "/app";

  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <div className="bottom-nav__bar">
        <NavLink
          to="/app/home"
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
