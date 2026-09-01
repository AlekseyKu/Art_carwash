import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function SplashPage() {
  const { ready, customer, onboardingDone } = useAuth();
  const navigate = useNavigate();
  const [minDelay, setMinDelay] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMinDelay(true), 900);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !minDelay) return;
    if (customer) {
      navigate("/app/price", { replace: true });
      return;
    }
    navigate(onboardingDone ? "/login" : "/welcome", { replace: true });
  }, [ready, minDelay, customer, onboardingDone, navigate]);

  return (
    <div className="splash">
      <div>
        <h1>Автомойка у ЖД</h1>
        <p>г. Ступино</p>
      </div>
    </div>
  );
}

export function SplashGate({ children }: { children: React.ReactNode }) {
  const { ready } = useAuth();
  if (!ready) return <SplashPage />;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (!customer) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
