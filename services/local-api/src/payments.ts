import type { PaymentMethod } from "@art/shared";
import { getSetting } from "./db.js";

export interface PaymentStartResult {
  ok: boolean;
  paymentId: string;
  status: "paid" | "pending" | "failed" | "cancelled";
  message?: string;
  qrPayload?: string;
}

export interface PaymentProvider {
  method: PaymentMethod;
  requiresOnline: boolean;
  start(amountKopecks: number, orderId: string): Promise<PaymentStartResult>;
  confirm?(paymentId: string): Promise<PaymentStartResult>;
  cancel?(paymentId: string): Promise<PaymentStartResult>;
}

const pending = new Map<string, { orderId: string; amount: number; method: PaymentMethod }>();

export class CashProvider implements PaymentProvider {
  method: PaymentMethod = "cash";
  requiresOnline = false;

  async start(amountKopecks: number, orderId: string): Promise<PaymentStartResult> {
    const paymentId = `cash_${orderId}`;
    return {
      ok: true,
      paymentId,
      status: "paid",
      message: `Наличные ${amountKopecks} коп.`,
    };
  }
}

/** Эмулятор / заглушка СБП. Реальный провайдер подключается через SbpHttpProvider. */
export class SbpQrProvider implements PaymentProvider {
  method: PaymentMethod = "sbp";
  requiresOnline = true;

  async start(amountKopecks: number, orderId: string): Promise<PaymentStartResult> {
    const paymentId = `sbp_${orderId}_${Date.now()}`;
    pending.set(paymentId, { orderId, amount: amountKopecks, method: "sbp" });
    const mode = process.env.ART_SBP_MODE ?? "emulator";
    if (mode === "http") {
      const url = process.env.ART_SBP_API_URL;
      if (!url) {
        return { ok: false, paymentId, status: "failed", message: "ART_SBP_API_URL не задан" };
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.ART_SBP_API_TOKEN ?? ""}`,
          },
          body: JSON.stringify({ amountKopecks, orderId }),
        });
        if (!res.ok) {
          return { ok: false, paymentId, status: "failed", message: `SBP HTTP ${res.status}` };
        }
        const data = (await res.json()) as { paymentId?: string; qrPayload?: string };
        return {
          ok: true,
          paymentId: data.paymentId ?? paymentId,
          status: "pending",
          qrPayload: data.qrPayload,
          message: "Ожидание оплаты СБП",
        };
      } catch (e) {
        return {
          ok: false,
          paymentId,
          status: "failed",
          message: e instanceof Error ? e.message : "SBP error",
        };
      }
    }

    return {
      ok: true,
      paymentId,
      status: "pending",
      qrPayload: `https://qr.nspk.ru/emulator?sum=${amountKopecks}&order=${orderId}`,
      message: "Эмулятор СБП: подтвердите оплату вручную",
    };
  }

  async confirm(paymentId: string): Promise<PaymentStartResult> {
    if (!pending.has(paymentId) && !paymentId.startsWith("sbp_")) {
      return { ok: false, paymentId, status: "failed", message: "Платёж не найден" };
    }
    pending.delete(paymentId);
    return { ok: true, paymentId, status: "paid", message: "СБП оплачено" };
  }

  async cancel(paymentId: string): Promise<PaymentStartResult> {
    pending.delete(paymentId);
    return { ok: true, paymentId, status: "cancelled", message: "СБП отменено" };
  }
}

/** Эмулятор терминала + generic HTTP / sdk_bridge под будущую модель. */
export class CardTerminalProvider implements PaymentProvider {
  method: PaymentMethod = "card";
  requiresOnline = false;

  async start(amountKopecks: number, orderId: string): Promise<PaymentStartResult> {
    const paymentId = `card_${orderId}_${Date.now()}`;
    pending.set(paymentId, { orderId, amount: amountKopecks, method: "card" });

    let config: { adapter?: string; host?: string; port?: number } = { adapter: "emulator" };
    try {
      config = JSON.parse(getSetting("terminal_config") ?? "{}");
    } catch {
      /* keep default */
    }

    const adapter = config.adapter ?? "emulator";

    if (adapter === "generic_http" && config.host) {
      try {
        const res = await fetch(`http://${config.host}:${config.port ?? 8080}/pay`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountKopecks, orderId, paymentId }),
        });
        if (!res.ok) {
          return { ok: false, paymentId, status: "failed", message: `Терминал HTTP ${res.status}` };
        }
        const data = (await res.json()) as { status?: string };
        if (data.status === "paid") {
          pending.delete(paymentId);
          return { ok: true, paymentId, status: "paid", message: "Оплата картой" };
        }
        return { ok: true, paymentId, status: "pending", message: "Ожидание терминала" };
      } catch (e) {
        return {
          ok: false,
          paymentId,
          status: "failed",
          message: e instanceof Error ? e.message : "Терминал недоступен",
        };
      }
    }

    if (adapter === "sdk_bridge") {
      const bridge = process.env.ART_TERMINAL_BRIDGE_URL ?? "http://127.0.0.1:3920";
      try {
        const res = await fetch(`${bridge}/pay`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountKopecks, orderId, paymentId }),
        });
        if (!res.ok) {
          return { ok: false, paymentId, status: "failed", message: `Bridge ${res.status}` };
        }
        const data = (await res.json()) as { status?: string; message?: string };
        if (data.status === "paid") {
          pending.delete(paymentId);
          return { ok: true, paymentId, status: "paid", message: data.message ?? "Оплата картой" };
        }
        return {
          ok: true,
          paymentId,
          status: (data.status as PaymentStartResult["status"]) ?? "pending",
          message: data.message,
        };
      } catch (e) {
        return {
          ok: false,
          paymentId,
          status: "failed",
          message: e instanceof Error ? e.message : "Bridge недоступен",
        };
      }
    }

    return {
      ok: true,
      paymentId,
      status: "pending",
      message: "Эмулятор терминала: подтвердите или отмените",
    };
  }

  async confirm(paymentId: string): Promise<PaymentStartResult> {
    pending.delete(paymentId);
    return { ok: true, paymentId, status: "paid", message: "Карта: успех (эмулятор)" };
  }

  async cancel(paymentId: string): Promise<PaymentStartResult> {
    pending.delete(paymentId);
    return { ok: true, paymentId, status: "cancelled", message: "Карта: отмена" };
  }
}

export const providers: Record<PaymentMethod, PaymentProvider> = {
  cash: new CashProvider(),
  sbp: new SbpQrProvider(),
  card: new CardTerminalProvider(),
};

export async function isOnline(): Promise<boolean> {
  const targets = [
    getSetting("cloud_sync_url")?.replace(/\/$/, "") + "/api/health",
    "https://www.msftconnecttest.com/connecttest.txt",
    "https://connectivitycheck.gstatic.com/generate_204",
  ].filter(Boolean) as string[];

  for (const url of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(url, { signal: ctrl.signal, method: "GET" });
      clearTimeout(t);
      if (res.ok || res.status === 204) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
