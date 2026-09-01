import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

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

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <div className="bottom-nav__bar">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              ["bottom-nav__item", isActive ? "bottom-nav__item--active" : ""]
                .filter(Boolean)
                .join(" ")
            }
            end
          >
            <span className="bottom-nav__icon">{tab.icon}</span>
            <span className="bottom-nav__label">{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
