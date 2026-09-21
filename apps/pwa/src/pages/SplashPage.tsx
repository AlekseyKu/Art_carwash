import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { SPLASH_MIN_DURATION_MS } from "../brand/logo";
import { SplashScreen } from "../components/layout/SplashScreen";

export function SplashPage() {
  const { ready, customer, onboardingDone } = useAuth();
  const navigate = useNavigate();
  const [minDelay, setMinDelay] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMinDelay(true), SPLASH_MIN_DURATION_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !minDelay) return;
    if (customer) {
      navigate("/app/home", { replace: true });
      return;
    }
    navigate(onboardingDone ? "/login" : "/welcome", { replace: true });
  }, [ready, minDelay, customer, onboardingDone, navigate]);

  return <SplashScreen />;
}

export function SplashGate({ children }: { children: React.ReactNode }) {
  const { ready } = useAuth();
  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { customer } = useAuth();
  if (!customer) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
