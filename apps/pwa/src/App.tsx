import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { AppShell } from "./components/AppShell";
import { BookingPage } from "./pages/BookingPage";
import { CabinetPage } from "./pages/CabinetPage";
import { LoginPage } from "./pages/LoginPage";
import { OwnerPage } from "./pages/OwnerPage";
import { PricePage } from "./pages/PricePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { RegisterPage } from "./pages/RegisterPage";
import {
  RequireAuth,
  SplashGate,
  SplashPage,
} from "./pages/SplashPage";
import { WelcomePage } from "./pages/WelcomePage";

function GuestOnly({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (customer) return <Navigate to="/app/price" replace />;
  return <>{children}</>;
}

function WelcomeGate() {
  const { onboardingDone } = useAuth();
  if (onboardingDone) return <Navigate to="/login" replace />;
  return <WelcomePage />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route
            path="/welcome"
            element={
              <SplashGate>
                <GuestOnly>
                  <WelcomeGate />
                </GuestOnly>
              </SplashGate>
            }
          />
          <Route
            path="/register"
            element={
              <SplashGate>
                <GuestOnly>
                  <RegisterPage />
                </GuestOnly>
              </SplashGate>
            }
          />
          <Route
            path="/login"
            element={
              <SplashGate>
                <GuestOnly>
                  <LoginPage />
                </GuestOnly>
              </SplashGate>
            }
          />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/owner" element={<OwnerPage />} />
          <Route
            path="/app"
            element={
              <SplashGate>
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              </SplashGate>
            }
          >
            <Route index element={<Navigate to="price" replace />} />
            <Route path="price" element={<PricePage />} />
            <Route path="booking" element={<BookingPage />} />
            <Route path="cabinet" element={<CabinetPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
