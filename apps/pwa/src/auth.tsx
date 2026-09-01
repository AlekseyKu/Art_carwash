import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, getToken, setToken, type Customer } from "./api";

const ONBOARDING_KEY = "art_pwa_onboarding_done";

interface AuthState {
  ready: boolean;
  customer: Customer | null;
  onboardingDone: boolean;
  setOnboardingDone: () => void;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: {
    phone: string;
    password: string;
    passwordConfirm: string;
    pdnAccepted: boolean;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [onboardingDone, setOnboardingDoneState] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === "1"
  );

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    apiClient
      .me()
      .then(setCustomer)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      customer,
      onboardingDone,
      setOnboardingDone: () => {
        localStorage.setItem(ONBOARDING_KEY, "1");
        setOnboardingDoneState(true);
      },
      async login(phone, password) {
        const res = await apiClient.login({ phone, password });
        setToken(res.token);
        setCustomer(res.customer);
      },
      async register(input) {
        const res = await apiClient.register({
          ...input,
          privacyPolicyVersion: "2026-08-30",
        });
        setToken(res.token);
        setCustomer(res.customer);
        localStorage.setItem(ONBOARDING_KEY, "1");
        setOnboardingDoneState(true);
      },
      async logout() {
        try {
          await apiClient.logout();
        } catch {
          /* ignore */
        }
        setToken(null);
        setCustomer(null);
      },
    }),
    [ready, customer, onboardingDone]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider required");
  return ctx;
}
