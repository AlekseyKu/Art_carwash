import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AdminPage } from "./pages/AdminPage";
import { CalendarPage } from "./pages/CalendarPage";
import { ClientsPage } from "./pages/ClientsPage";
import { PosPage } from "./pages/PosPage";
import { ReportsPage } from "./pages/ReportsPage";

export function App() {
  return (
    <HashRouter>
      <ErrorBoundary label="Приложение">
        <Routes>
          <Route
            path="/"
            element={
              <ErrorBoundary label="Касса">
                <PosPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/calendar"
            element={
              <ErrorBoundary label="Календарь">
                <CalendarPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/clients"
            element={
              <ErrorBoundary label="Клиенты">
                <ClientsPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/admin"
            element={
              <ErrorBoundary label="Админ">
                <AdminPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="/reports"
            element={
              <ErrorBoundary label="Отчёты">
                <ReportsPage />
              </ErrorBoundary>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
