export interface Customer {
  id: string;
  phone: string;
  phoneDisplay: string;
  name: string | null;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  classId: string;
  nickname: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSnapshot {
  version: string;
  updatedAt: string;
  site: {
    name: string;
    city: string;
    phone: string;
    hoursText: string;
    lat: number;
    lon: number;
    addressText: string;
    schedule?: {
      days: {
        weekday: number;
        closed: boolean;
        open: string;
        close: string;
      }[];
    };
  };
  bookingRules: {
    horizonDays: number;
    minLeadHours: number;
    cancelBeforeHours: number;
    defaultDurationMinutes: number;
  };
  tabs: {
    id: string;
    slug: string;
    name: string;
    sortOrder: number;
    active: boolean;
  }[];
  services: {
    id: string;
    name: string;
    description: string;
    tabId: string;
    active: boolean;
    sortOrder: number;
    priceKopecks: number | null;
    durationMinutes: number | null;
    visibleInPwa?: boolean;
  }[];
  vehicleClasses: {
    id: string;
    slug: string;
    name: string;
    description: string;
    iconKey: string;
    sortOrder: number;
    active: boolean;
  }[];
  servicePrices: {
    serviceId: string;
    classId: string;
    priceKopecks: number;
  }[];
}

const TOKEN_KEY = "art_pwa_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(
  path: string,
  init?: RequestInit & { auth?: boolean }
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (init?.body != null) {
    headers["content-type"] = "application/json";
  }
  if (init?.auth !== false) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

export const apiClient = {
  register(body: {
    phone: string;
    password: string;
    passwordConfirm: string;
    pdnAccepted: boolean;
    privacyPolicyVersion: string;
  }) {
    return api<{
      ok: boolean;
      token: string;
      customer: Customer;
    }>("/api/customer/register", { method: "POST", body: JSON.stringify(body), auth: false });
  },

  login(body: { phone: string; password: string }) {
    return api<{
      ok: boolean;
      token: string;
      customer: Customer;
    }>("/api/customer/login", { method: "POST", body: JSON.stringify(body), auth: false });
  },

  logout() {
    return api<{ ok: boolean }>("/api/customer/logout", { method: "POST" });
  },

  me() {
    return api<Customer>("/api/customer/me");
  },

  updateMe(body: { name: string | null }) {
    return api<Customer>("/api/customer/me", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  catalog() {
    return api<CatalogSnapshot>("/api/customer/catalog");
  },

  listVehicles() {
    return api<{ vehicles: Vehicle[] }>("/api/customer/vehicles");
  },

  createVehicle(body: {
    plateNumber: string;
    classId: string;
    nickname?: string | null;
    isDefault?: boolean;
  }) {
    return api<Vehicle>("/api/customer/vehicles", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateVehicle(
    id: string,
    body: {
      plateNumber?: string;
      classId?: string;
      nickname?: string | null;
      isDefault?: boolean;
    }
  ) {
    return api<Vehicle>(`/api/customer/vehicles/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  deleteVehicle(id: string) {
    return api<{ ok: boolean }>(`/api/customer/vehicles/${id}`, { method: "DELETE" });
  },

  slots(params: {
    date: string;
    mainServiceId: string;
    addonIds?: string[];
  }) {
    const q = new URLSearchParams({
      date: params.date,
      mainServiceId: params.mainServiceId,
    });
    if (params.addonIds?.length) q.set("addonIds", params.addonIds.join(","));
    return api<{
      date: string;
      durationMinutes: number;
      timezone: string;
      slots: { startsAt: string; endsAt: string; time: string }[];
    }>(`/api/customer/slots?${q}`);
  },

  listBookings() {
    return api<{ bookings: BookingDto[] }>("/api/customer/bookings");
  },

  createBooking(body: {
    vehicleId: string;
    mainServiceId: string;
    addonIds?: string[];
    startsAt: string;
  }) {
    return api<BookingDto>("/api/customer/bookings", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  cancelBooking(id: string) {
    return api<BookingDto>(`/api/customer/bookings/${id}/cancel`, { method: "POST" });
  },

  ownerLogin(password: string) {
    return api<{ ok: boolean; token: string }>("/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password }),
      auth: false,
    });
  },
};

export type BookingDto = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  classId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  totalKopecks: number;
  items: {
    id: string;
    serviceId: string;
    serviceName: string;
    kind: string;
    priceKopecks: number;
    durationMinutes: number;
  }[];
};

export function yandexRouteUrl(lat: number, lon: number): string {
  return `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`;
}

export function yandexNaviUrl(lat: number, lon: number): string {
  return `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`;
}

export function openRoute(lat: number, lon: number) {
  const navi = yandexNaviUrl(lat, lon);
  window.location.href = navi;
  window.setTimeout(() => {
    window.open(yandexRouteUrl(lat, lon), "_blank", "noopener");
  }, 600);
}
