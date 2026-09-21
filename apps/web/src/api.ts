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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isUnauthorized(err: unknown): boolean {
  return (
    (err instanceof ApiError && err.status === 401) ||
    (err instanceof Error && /unauthorized|сессия истекла/i.test(err.message))
  );
}

function clearStaleSession(url: string) {
  if (url.includes("/api/auth/washer") || url.includes("/api/auth/admin")) return;
  if (url.includes("/cloud-api") || url.includes("/owner/")) {
    setOwnerToken(null);
    window.dispatchEvent(new CustomEvent("art:unauthorized", { detail: "owner" }));
    return;
  }
  if (url.includes("/api/admin")) {
    setAdminToken(null);
    window.dispatchEvent(new CustomEvent("art:unauthorized", { detail: "admin" }));
    return;
  }
  setWasherToken(null);
  window.dispatchEvent(new CustomEvent("art:unauthorized", { detail: "washer" }));
}

async function request<T>(
  url: string,
  opts: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("content-type", "application/json");
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  let res: Response;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch {
    throw new ApiError("Нет связи с сервером кассы. Проверьте, что программа запущена.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: string }).error ||
      (res.status === 502 || res.status === 503
        ? "Сервис временно недоступен"
        : res.statusText || `Ошибка ${res.status}`);
    if (res.status === 401) {
      clearStaleSession(url);
      throw new ApiError("Сессия недействительна — войдите снова", 401);
    }
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  status: () =>
    request<{ online: boolean; pendingSync: number; siteName: string; desktop?: boolean }>(
      "/api/status"
    ),
  desktopMinimize: () =>
    request<{ ok?: boolean; error?: string }>("/api/desktop/minimize", {
      method: "POST",
      body: "{}",
    }),
  desktopClose: () =>
    request<{ ok?: boolean; error?: string }>("/api/desktop/close", {
      method: "POST",
      body: "{}",
    }),
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
  catalog: (classId?: string) =>
    request<{
      vehicleClasses: VehicleClassDto[];
      tabs: CatalogTabDto[];
      services: CatalogItemDto[];
      discounts: { id: string; name: string; type: string; value: number }[];
      staffWashers: StaffWasherDto[];
    }>(`/api/catalog${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`),
  bookingsDay: (token: string, date: string) =>
    request<{
      date: string;
      timezone: string;
      today: string;
      slots: {
        time: string;
        startsAt: string;
        booking: BookingDto | null;
      }[];
      bookings: BookingDto[];
    }>(`/api/bookings?date=${encodeURIComponent(date)}`, { token }),
  cancelBooking: (token: string, id: string) =>
    request<BookingDto>(`/api/bookings/${id}/cancel`, {
      method: "POST",
      token,
      body: JSON.stringify({}),
    }),
  arriveBooking: (token: string, id: string, postId = 1) =>
    request<{ booking: BookingDto; order: OrderDto }>(`/api/bookings/${id}/arrive`, {
      method: "POST",
      token,
      body: JSON.stringify({ postId }),
    }),
  createBooking: (
    token: string,
    body: {
      startsAt: string;
      durationMinutes?: number;
      customerId?: string | null;
      customerName?: string | null;
      customerPhone?: string | null;
      plateNumber?: string | null;
      classId?: string | null;
      items: {
        serviceId: string;
        serviceName: string;
        kind: "main" | "addon";
        priceKopecks: number;
        durationMinutes: number;
      }[];
    }
  ) =>
    request<BookingDto>("/api/bookings", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  draft: (postId: number, token: string) =>
    request<OrderDto>(`/api/orders/draft?postId=${postId}`, { token }),
  recentOrders: (token: string, limit = 5) =>
    request<{ orders: RecentOrderDto[] }>(`/api/orders/recent?limit=${limit}`, { token }),
  saveOrder: (
    id: string,
    body: {
      items: OrderItemInput[];
      discountId: string | null;
      staffWasherIds?: string[];
    },
    token: string
  ) =>
    request<OrderDto>(`/api/orders/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    }),
  setVehicleClass: (orderId: string, classId: string, token: string) =>
    request<OrderDto>(`/api/orders/${orderId}/vehicle-class`, {
      method: "PUT",
      body: JSON.stringify({ classId }),
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
    body: {
      method: "cash" | "card" | "sbp";
      tipsKopecks?: number;
      emulateResult?: "success" | "cancel";
    },
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
  searchClients: (query: string, token: string, limit = 20) =>
    request<{ clients: ClientDto[] }>(
      `/api/clients?query=${encodeURIComponent(query)}&limit=${limit}`,
      { token }
    ),
  listClients: (token: string, limit = 100) =>
    request<{ clients: ClientDto[] }>(`/api/clients?limit=${limit}`, { token }),
  upsertClient: (
    body: { plate?: string; phone?: string; name?: string; id?: string },
    token: string
  ) => request<ClientDto>("/api/clients", { method: "POST", body: JSON.stringify(body), token }),
  deleteClient: (id: string, token: string) =>
    request<{ ok: boolean }>(`/api/clients/${id}`, { method: "DELETE", token }),
  attachClient: (orderId: string, clientId: string | null, token: string) =>
    request<OrderDto>(`/api/orders/${orderId}/client`, {
      method: "PUT",
      body: JSON.stringify({ clientId }),
      token,
    }),
  shiftCurrent: (token: string) =>
    request<{
      shift: ShiftDto | null;
      needsOpen: boolean;
      needsRollover: boolean;
      todayLabel: string;
    }>("/api/shifts/current", { token }),
  shiftOpen: (token: string) =>
    request<{ shift: ShiftDto; created: boolean }>("/api/shifts/open", {
      method: "POST",
      token,
      body: "{}",
    }),
  shiftRollover: (token: string) =>
    request<{
      closedReport: ShiftReportDto | null;
      shift: ShiftDto;
      created: boolean;
    }>("/api/shifts/rollover", { method: "POST", token, body: "{}" }),
  shiftClose: (token: string) =>
    request<ShiftReportDto>("/api/shifts/close", { method: "POST", token, body: "{}" }),
  shiftReport: (id: string, token: string) =>
    request<ShiftReportDto>(`/api/shifts/${id}/report`, { token }),
};

export type ShiftDto = {
  id: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  openedByWasherId: string | null;
  closedByWasherId: string | null;
  openedByName?: string | null;
  closedByName?: string | null;
  note?: string | null;
  orderCount?: number;
  totalKopecks?: number;
};

export type ShiftReportDto = {
  shift: ShiftDto;
  totalKopecks: number;
  tipsKopecks?: number;
  orderCount: number;
  byPaymentMethod: { label: string; totalKopecks: number; count: number }[];
  orders: {
    id: string;
    number: number;
    status: string;
    paymentMethod: string | null;
    subtotalKopecks: number;
    discountKopecks: number;
    totalKopecks: number;
    tipsKopecks?: number;
    paidAt: string | null;
    createdAt: string;
    washerId: string;
    washerName: string | null;
    plateNumber: string | null;
    items: {
      nameSnapshot: string;
      priceKopecks: number;
      qty: number;
      lineTotalKopecks: number;
    }[];
  }[];
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

export type BookingDto = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  vehicleId: string | null;
  plateNumber: string | null;
  classId: string | null;
  postId: number;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  totalKopecks: number;
  localOrderId: string | null;
  items: {
    id: string;
    serviceId: string;
    serviceName: string;
    kind: string;
    priceKopecks: number;
    durationMinutes: number;
  }[];
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

export type OrderItemInput = {
  serviceId?: string | null;
  name?: string;
  qty: number;
  priceKopecks?: number;
  basePriceKopecks?: number;
  coefficientExtraKopecks?: number;
  isManual?: boolean;
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
  tipsKopecks?: number;
  discountId: string | null;
  vehicleClassId: string | null;
  vehicleClassName: string | null;
  staffWasherIds?: string[];
  staffWashers?: { id: string; name: string; salaryPercent: number }[];
  items: {
    id?: string;
    serviceId: string | null;
    nameSnapshot: string;
    priceKopecks: number;
    qty: number;
    isManual?: boolean;
    basePriceKopecks?: number;
    coefficientExtraKopecks?: number;
  }[];
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
  description: string;
  priceKopecks: number;
  active: boolean;
  sortOrder: number;
  tabId: string;
  coefficientEnabled?: boolean;
  coefficientStepKopecks?: number;
  durationMinutes?: number;
  visibleInPwa?: boolean;
};

export type StaffWasherDto = {
  id: string;
  name: string;
  salaryPercent: number;
  active?: boolean;
  sortOrder?: number;
};

export type VehicleClassDto = {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconKey: string;
  sortOrder: number;
  active: boolean;
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
      description?: string;
      priceKopecks: number;
      active: boolean;
      sortOrder: number;
      tabId: string;
      coefficientEnabled?: boolean;
      coefficientStepKopecks?: number;
      durationMinutes?: number;
      visibleInPwa?: boolean;
    },
    id?: string
  ) =>
    id
      ? request(`/api/admin/services/${id}`, { method: "PUT", body: JSON.stringify(body), token })
      : request("/api/admin/services", { method: "POST", body: JSON.stringify(body), token }),
  deleteService: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/services/${id}`, { method: "DELETE", token }),
  vehicleClasses: (token: string) =>
    request<VehicleClassDto[]>("/api/admin/vehicle-classes", { token }),
  saveVehicleClass: (
    token: string,
    body: {
      name: string;
      description?: string;
      slug?: string;
      iconKey?: string;
      sortOrder?: number;
      active?: boolean;
    },
    id?: string
  ) =>
    id
      ? request(`/api/admin/vehicle-classes/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: body.name,
            description: body.description ?? "",
            iconKey: body.iconKey,
            sortOrder: body.sortOrder ?? 0,
            active: body.active !== false,
          }),
          token,
        })
      : request("/api/admin/vehicle-classes", {
          method: "POST",
          body: JSON.stringify(body),
          token,
        }),
  deleteVehicleClass: (token: string, id: string) =>
    request<{ ok: boolean; soft?: boolean }>(`/api/admin/vehicle-classes/${id}`, {
      method: "DELETE",
      token,
    }),
  servicePrices: (token: string, classId?: string, tabSlug?: string) => {
    const params = new URLSearchParams();
    if (classId) params.set("classId", classId);
    if (tabSlug) params.set("tabSlug", tabSlug);
    const q = params.toString();
    return request<{
      classId: string;
      tabSlug?: string;
      items: {
        serviceId: string;
        name: string;
        priceKopecks: number | null;
        durationMinutes?: number;
      }[];
    }>(`/api/admin/service-prices${q ? `?${q}` : ""}`, { token });
  },
  saveServicePrices: (
    token: string,
    body: {
      classId: string;
      items: {
        serviceId: string;
        priceKopecks: number | null;
        durationMinutes?: number;
      }[];
    }
  ) =>
    request<{ ok: boolean }>("/api/admin/service-prices", {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    }),
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
  staffWashers: (token: string) =>
    request<StaffWasherDto[]>("/api/admin/staff-washers", { token }),
  saveStaffWasher: (
    token: string,
    body: { name: string; salaryPercent: number; active: boolean; sortOrder?: number },
    id?: string
  ) =>
    id
      ? request(`/api/admin/staff-washers/${id}`, {
          method: "PUT",
          body: JSON.stringify(body),
          token,
        })
      : request("/api/admin/staff-washers", {
          method: "POST",
          body: JSON.stringify(body),
          token,
        }),
  deleteStaffWasher: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/staff-washers/${id}`, { method: "DELETE", token }),
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
  analyticsByWasher: (
    token: string,
    query: { mode: "shift" | "week" | "month" | "range"; from?: string; to?: string; shiftId?: string }
  ) => {
    const params = new URLSearchParams();
    params.set("mode", query.mode);
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.shiftId) params.set("shiftId", query.shiftId);
    return request<{
      from: string;
      to: string;
      mode?: string;
      shiftId?: string | null;
      washers: {
        id: string;
        name: string;
        salaryPercent: number;
        orderCount: number;
        revenueKopecks: number;
        tipsKopecks: number;
        salaryKopecks: number;
      }[];
    }>(`/api/admin/analytics/by-washer?${params}`, { token });
  },
  shifts: (token: string, limit = 40) =>
    request<{
      shifts: ShiftDto[];
      current: {
        shift: ShiftDto | null;
        needsOpen: boolean;
        needsRollover: boolean;
        todayLabel: string;
      };
    }>(`/api/admin/shifts?limit=${limit}`, { token }),
  shiftReport: (token: string, id: string) =>
    request<ShiftReportDto>(`/api/admin/shifts/${id}`, { token }),
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
  publishCatalog: (token: string) =>
    request<{ synced: number; error?: string }>("/api/admin/publish-catalog", {
      method: "POST",
      token,
      body: JSON.stringify({}),
    }),
  syncSettings: (token: string) =>
    request<{ cloudSyncUrl: string | null; hasToken: boolean }>("/api/admin/sync-settings", {
      token,
    }),
  saveSyncSettings: (token: string, cloudSyncUrl: string, cloudSyncToken?: string) =>
    request("/api/admin/sync-settings", {
      method: "PUT",
      body: JSON.stringify({ cloudSyncUrl, cloudSyncToken }),
      token,
    }),
  siteSchedule: (token: string) =>
    request<{
      days: { weekday: number; closed: boolean; open: string; close: string }[];
    }>("/api/admin/site-schedule", { token }),
  saveSiteSchedule: (
    token: string,
    body: { days: { weekday: number; closed: boolean; open: string; close: string }[] }
  ) =>
    request<{
      days: { weekday: number; closed: boolean; open: string; close: string }[];
    }>("/api/admin/site-schedule", {
      method: "PUT",
      body: JSON.stringify(body),
      token,
    }),
  updatesStatus: (token: string) =>
    request<{
      ok?: boolean;
      desktop?: boolean;
      updating?: boolean;
      currentVersion?: string;
      repo?: string;
      message?: string;
      hasGithubToken?: boolean;
      runtimeSource?: string;
      runtimeDir?: string;
      updatesDir?: string;
      logPath?: string;
    }>("/api/admin/updates/status", { token }),
  updatesCheck: (token: string) =>
    request<{
      ok?: boolean;
      updateAvailable?: boolean;
      currentVersion?: string;
      latestVersion?: string | null;
      message?: string;
      releaseNotes?: string;
      releaseUrl?: string | null;
      desktop?: boolean;
      hasGithubToken?: boolean;
      repo?: string;
      runtimeSource?: string;
      runtimeDir?: string;
      updatesDir?: string;
      logPath?: string;
    }>("/api/admin/updates/check", { method: "POST", token, body: "{}" }),
  updatesApply: (token: string) =>
    request<{
      ok?: boolean;
      applied?: boolean;
      restart?: boolean;
      currentVersion?: string;
      latestVersion?: string;
      message?: string;
      error?: string;
      runtimeDir?: string;
      logPath?: string;
    }>("/api/admin/updates/apply", { method: "POST", token, body: "{}" }),
  updatesSetGithubToken: (token: string, githubToken: string) =>
    request<{ ok?: boolean; hasGithubToken?: boolean; message?: string }>(
      "/api/admin/updates/github-token",
      {
        method: "POST",
        token,
        body: JSON.stringify({ token: githubToken }),
      }
    ),
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
