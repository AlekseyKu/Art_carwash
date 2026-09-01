import { formatRub } from "@art/shared";
import { NavLink, Outlet } from "react-router-dom";

export function AppShell() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="bottom-nav">
        <NavLink to="/app/price" className={({ isActive }) => (isActive ? "active" : "")}>
          Прайс
        </NavLink>
        <NavLink to="/app/booking" className={({ isActive }) => (isActive ? "active" : "")}>
          Запись
        </NavLink>
        <NavLink to="/app/cabinet" className={({ isActive }) => (isActive ? "active" : "")}>
          Кабинет
        </NavLink>
      </nav>
    </div>
  );
}

export function PriceLabel({ kopecks }: { kopecks: number }) {
  return <span>{formatRub(kopecks)}</span>;
}
