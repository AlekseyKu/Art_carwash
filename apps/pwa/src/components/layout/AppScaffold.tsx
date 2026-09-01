import { Outlet } from "react-router-dom";
import { BottomNav } from "../nav/BottomNav";

export function AppScaffold() {
  return (
    <div className="app-scaffold">
      <main className="app-scaffold__main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
