const WASHER_KEY = "art_washer_token";
const ADMIN_KEY = "art_admin_token";
const OWNER_KEY = "art_owner_token";

export function getWasherToken() {
  return localStorage.getItem(WASHER_KEY);
}
export function setWasherToken(t: string | null) {
  if (t) localStorage.setItem(WASHER_KEY, t);
  else localStorage.removeItem(WASHER_KEY);
}
export function getAdminToken() {
  return localStorage.getItem(ADMIN_KEY);
}
export function setAdminToken(t: string | null) {
  if (t) localStorage.setItem(ADMIN_KEY, t);
  else localStorage.removeItem(ADMIN_KEY);
}
export function getOwnerToken() {
  return localStorage.getItem(OWNER_KEY);
}
export function setOwnerToken(t: string | null) {
  if (t) localStorage.setItem(OWNER_KEY, t);
  else localStorage.removeItem(OWNER_KEY);
}

async function request<T>(
  url: string,
  opts: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("content-type", "application/json");
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export const api = {
  status: () => request<{ online: boolean; pendingSync: number; siteName: string }>("/api/status"),
  loginWasher: (pin: string) =>
    request<{ ok: boolean; token?: string; washer?: { id: string; name: string }; error?: string }>(
      "/api/auth/washer",
      { method: "POST", body: JSON.stringify({ pin }) }
    ),
  loginAdmin: (code: string) =>
    request<{ ok: boolean; token?: string; error?: string }>("/api/auth/admin", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  logout: (token: string) =>
    request("/api/auth/logout", { method: "POST", token, body: JSON.stringify({}) }),
  catalog: () =>
    request<{
      tabs: CatalogTabDto[];
      services: CatalogItemDto[];
      discounts: { id: string; name: string; type: string; value: number }[];
    }>("/api/catalog"),
  draft: (postId: number, token: string) =>
    request<OrderDto>(`/api/orders/draft?postId=${postId}`, { token }),
  recentOrders: (token: string, limit = 5) =>
    request<{ orders: RecentOrderDto[] }>(`/api/orders/recent?limit=${limit}`, { token }),
  saveOrder: (
    id: string,
    body: { items: { serviceId: string; qty: number }[]; discountId: string | null },
    token: string
  ) =>
    request<OrderDto>(`/api/orders/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    }),
  checkout: (id: string, token: string) =>
    request<OrderDto>(`/api/orders/${id}/checkout`, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    }),
  pay: (
    id: string,
    body: { method: "cash" | "card" | "sbp"; emulateResult?: "success" | "cancel" },
    token: string
  ) =>
    request<{
      ok: boolean;
      blocked?: boolean;
      error?: string;
      pending?: boolean;
      cancelled?: boolean;
      order?: OrderDto;
      payment?: { paymentId: string; qrPayload?: string; message?: string; status: string };
    }>(`/api/orders/${id}/pay`, { method: "POST", body: JSON.stringify(body), token }),
  resolvePay: (
    id: string,
    body: { paymentId: string; method: "cash" | "card" | "sbp"; action: "confirm" | "cancel" },
    token: string
  ) =>
    request<{ ok: boolean; order?: OrderDto }>(`/api/orders/${id}/pay/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
      token,
    }),
  cancelOrder: (id: string, token: string) =>
    request(`/api/orders/${id}/cancel`, { method: "POST", token, body: JSON.stringify({}) }),
  anprLatest: (token: string) =>
    request<{ event: AnprEventDto | null }>("/api/anpr/latest", { token }),
  anprEvent: (body: { plate: string; confidence?: number; source?: string }) =>
    request<AnprEventDto>("/api/anpr/event", { method: "POST", body: JSON.stringify(body) }),
  clientByPlate: (plate: string, token: string) =>
    request<{ client: ClientDto | null }>(
      `/api/clients/by-plate?plate=${encodeURIComponent(plate)}`,
      { token }
    ),
  upsertClient: (
    body: { plate?: string; phone?: string; name?: string; id?: string },
    token: string
  ) => request<ClientDto>("/api/clients", { method: "POST", body: JSON.stringify(body), token }),
  attachClient: (orderId: string, clientId: string | null, token: string) =>
    request<OrderDto>(`/api/orders/${orderId}/client`, {
      method: "PUT",
      body: JSON.stringify({ clientId }),
      token,
    }),
};

export type ClientDto = {
  id: string;
  phone: string | null;
  plateNumber: string | null;
  name: string | null;
  points: number;
  tier: string;
  personalDiscountPercent: number;
  visitCount: number;
  lastVisitAt: string | null;
};

export type AnprEventDto = {
  id: string;
  plate: string;
  plateNormalized: string;
  confidence: number | null;
  snapshotUrl: string | null;
  source: string;
  createdAt: string;
  client: ClientDto | null;
};

export type OrderDto = {
  id: string;
  number: number;
  postId: number;
  status: string;
  clientId: string | null;
  totalKopecks: number;
  subtotalKopecks: number;
  discountKopecks: number;
  discountId: string | null;
  items: { serviceId: string; nameSnapshot: string; priceKopecks: number; qty: number }[];
};

export type RecentOrderDto = {
  id: string;
  number: number;
  postId: number;
  status: string;
  paymentMethod: string | null;
  totalKopecks: number;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  plateNumber: string | null;
  washerName: string | null;
  itemsPreview: string[];
};

export type CatalogTabDto = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  active: boolean;
};

export type CatalogItemDto = {
  id: string;
  name: string;
  priceKopecks: number;
  active: boolean;
  sortOrder: number;
  tabId: string;
};

export const adminApi = {
  catalogTabs: (token: string) =>
    request<CatalogTabDto[]>("/api/admin/catalog-tabs", { token }),
  saveCatalogTab: (
    token: string,
    body: { name: string; slug?: string; sortOrder?: number; active?: boolean },
    id?: string
  ) =>
    id
      ? request(`/api/admin/catalog-tabs/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: body.name,
            sortOrder: body.sortOrder ?? 0,
            active: body.active !== false,
          }),
          token,
        })
      : request("/api/admin/catalog-tabs", {
          method: "POST",
          body: JSON.stringify(body),
          token,
        }),
  deleteCatalogTab: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/catalog-tabs/${id}`, { method: "DELETE", token }),
  services: (token: string) =>
    request<CatalogItemDto[]>("/api/admin/services", { token }),
  saveService: (
    token: string,
    body: {
      name: string;
      priceKopecks: number;
      active: boolean;
      sortOrder: number;
      tabId: string;
    },
    id?: string
  ) =>
    id
      ? request(`/api/admin/services/${id}`, { method: "PUT", body: JSON.stringify(body), token })
      : request("/api/admin/services", { method: "POST", body: JSON.stringify(body), token }),
  deleteService: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/services/${id}`, { method: "DELETE", token }),
  discounts: (token: string) =>
    request<{ id: string; name: string; type: string; value: number; active: boolean }[]>(
      "/api/admin/discounts",
      { token }
    ),
  saveDiscount: (
    token: string,
    body: { name: string; type: string; value: number; active: boolean },
    id?: string
  ) =>
    id
      ? request(`/api/admin/discounts/${id}`, { method: "PUT", body: JSON.stringify(body), token })
      : request("/api/admin/discounts", { method: "POST", body: JSON.stringify(body), token }),
  deleteDiscount: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/discounts/${id}`, { method: "DELETE", token }),
  washers: (token: string) =>
    request<{ id: string; name: string; active: boolean }[]>("/api/admin/washers", { token }),
  saveWasher: (
    token: string,
    body: { name: string; pin?: string; active: boolean },
    id?: string
  ) =>
    id
      ? request(`/api/admin/washers/${id}`, { method: "PUT", body: JSON.stringify(body), token })
      : request("/api/admin/washers", {
          method: "POST",
          body: JSON.stringify({ ...body, pin: body.pin }),
          token,
        }),
  deleteWasher: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/washers/${id}`, { method: "DELETE", token }),
  terminal: (token: string) => request<Record<string, unknown>>("/api/admin/terminal", { token }),
  saveTerminal: (token: string, body: Record<string, unknown>) =>
    request("/api/admin/terminal", { method: "PUT", body: JSON.stringify(body), token }),
  analytics: (token: string, period: "day" | "month") =>
    request<{
      totalKopecks: number;
      orderCount: number;
      byService: { label: string; totalKopecks: number; count: number }[];
      byPost: { label: string; totalKopecks: number; count: number }[];
      byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
    }>(`/api/admin/analytics?period=${period}`, { token }),
  changeMaster: (token: string, current: string, next: string) =>
    request<{ ok: boolean; error?: string }>("/api/admin/master-code", {
      method: "POST",
      body: JSON.stringify({ current, next }),
      token,
    }),
  sync: (token: string) =>
    request<{ synced: number; error?: string }>("/api/admin/sync", {
      method: "POST",
      token,
      body: JSON.stringify({}),
    }),
  syncSettings: (token: string) =>
    request<{ cloudSyncUrl: string | null }>("/api/admin/sync-settings", { token }),
  saveSyncSettings: (token: string, cloudSyncUrl: string, cloudSyncToken?: string) =>
    request("/api/admin/sync-settings", {
      method: "PUT",
      body: JSON.stringify({ cloudSyncUrl, cloudSyncToken }),
      token,
    }),
};

export const ownerApi = {
  login: (password: string) =>
    request<{ ok: boolean; token?: string; error?: string }>("/cloud-api/api/owner/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  analytics: (token: string, period: "day" | "month") =>
    request<{
      totalKopecks: number;
      orderCount: number;
      byService: { label: string; totalKopecks: number; count: number }[];
      byPost: { label: string; totalKopecks: number; count: number }[];
      byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
    }>(`/cloud-api/api/owner/analytics?period=${period}`, { token }),
};
