import { formatRub } from "@art/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiClient, type CatalogSnapshot, type Vehicle } from "../api";
import { PageHeader } from "../components/layout/PageHeader";
import { Button, Card, FormError } from "../components/ui";

const CLASS_PRICED = new Set(["services", "extra-services"]);

type Step = "vehicle" | "main" | "addons" | "datetime" | "done";

function priceOf(catalog: CatalogSnapshot, serviceId: string, classId: string, tabSlug: string) {
  if (CLASS_PRICED.has(tabSlug)) {
    return (
      catalog.servicePrices.find((p) => p.serviceId === serviceId && p.classId === classId)
        ?.priceKopecks ?? null
    );
  }
  return catalog.services.find((s) => s.id === serviceId)?.priceKopecks ?? null;
}

function mskToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatDateLabel(date: string) {
  const d = new Date(`${date}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

export function BookingPage() {
  const [step, setStep] = useState<Step>("vehicle");
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [vehicleId, setVehicleId] = useState("");
  const [mainId, setMainId] = useState("");
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [date, setDate] = useState(mskToday());
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string; time: string }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([apiClient.catalog(), apiClient.listVehicles()])
      .then(([c, v]) => {
        setCatalog(c);
        setVehicles(v.vehicles);
        const def = v.vehicles.find((x) => x.isDefault) ?? v.vehicles[0];
        if (def) setVehicleId(def.id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, []);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const classId = vehicle?.classId ?? "";

  const servicesTab = useMemo(
    () => catalog?.tabs.find((t) => t.slug === "services" && t.active),
    [catalog]
  );
  const extrasTab = useMemo(
    () => catalog?.tabs.find((t) => t.slug === "extra-services" && t.active),
    [catalog]
  );

  const mainServices = useMemo(() => {
    if (!catalog || !servicesTab || !classId) return [];
    return catalog.services
      .filter((s) => s.active && s.tabId === servicesTab.id)
      .filter((s) => priceOf(catalog, s.id, classId, "services") != null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catalog, servicesTab, classId]);

  const addonServices = useMemo(() => {
    if (!catalog || !extrasTab || !classId) return [];
    return catalog.services
      .filter((s) => s.active && s.tabId === extrasTab.id)
      .filter((s) => priceOf(catalog, s.id, classId, "extra-services") != null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [catalog, extrasTab, classId]);

  const horizonDays = catalog?.bookingRules.horizonDays ?? 14;
  const dates = useMemo(() => {
    const today = mskToday();
    return Array.from({ length: horizonDays }, (_, i) => addDays(today, i));
  }, [horizonDays]);

  const durationMinutes = useMemo(() => {
    if (!catalog || !mainId) return 0;
    const main = catalog.services.find((s) => s.id === mainId);
    let d =
      main?.durationMinutes && main.durationMinutes > 0
        ? main.durationMinutes
        : catalog.bookingRules.defaultDurationMinutes;
    for (const id of addonIds) {
      const a = catalog.services.find((s) => s.id === id);
      d += a?.durationMinutes && a.durationMinutes > 0 ? a.durationMinutes : 15;
    }
    return d;
  }, [catalog, mainId, addonIds]);

  const totalKopecks = useMemo(() => {
    if (!catalog || !classId || !mainId) return 0;
    let sum = priceOf(catalog, mainId, classId, "services") ?? 0;
    for (const id of addonIds) {
      sum += priceOf(catalog, id, classId, "extra-services") ?? 0;
    }
    return sum;
  }, [catalog, classId, mainId, addonIds]);

  useEffect(() => {
    if (step !== "datetime" || !mainId || !date) return;
    setSlotsLoading(true);
    setStartsAt("");
    setError("");
    apiClient
      .slots({ date, mainServiceId: mainId, addonIds })
      .then((r) => setSlots(r.slots))
      .catch((e) => {
        setSlots([]);
        setError(e instanceof Error ? e.message : "Не удалось загрузить слоты");
      })
      .finally(() => setSlotsLoading(false));
  }, [step, date, mainId, addonIds]);

  async function confirm() {
    if (!vehicleId || !mainId || !startsAt) return;
    setSaving(true);
    setError("");
    try {
      const b = await apiClient.createBooking({
        vehicleId,
        mainServiceId: mainId,
        addonIds,
        startsAt,
      });
      const time = slots.find((s) => s.startsAt === b.startsAt)?.time ?? "";
      setDoneMsg(`Запись на ${formatDateLabel(date)} в ${time}. Оплата на мойке.`);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось записаться");
    } finally {
      setSaving(false);
    }
  }

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Запись" subtitle="Онлайн-запись на мойку" />
        <p className="price-loading">Загрузка…</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Запись" subtitle="Онлайн-запись на мойку" />
      <FormError message={error} />

      {step === "done" && (
        <Card className="booking-done">
          <p className="booking-done__text">{doneMsg}</p>
          <Button
            type="button"
            block
            onClick={() => {
              setStep("vehicle");
              setMainId("");
              setAddonIds([]);
              setStartsAt("");
              setDoneMsg("");
            }}
          >
            Новая запись
          </Button>
          <ButtonLinkLike to="/app/cabinet" />
        </Card>
      )}

      {step === "vehicle" && (
        <section className="booking-step">
          <h2 className="ui-title-sm">Автомобиль</h2>
          {!vehicles.length ? (
            <Card>
              <p className="booking-hint">Сначала добавьте авто в гараж.</p>
              <Link className="ui-btn ui-btn--primary ui-btn--block" to="/app/cabinet">
                Открыть кабинет
              </Link>
            </Card>
          ) : (
            <ul className="booking-list">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`booking-choice${vehicleId === v.id ? " booking-choice--on" : ""}`}
                    onClick={() => setVehicleId(v.id)}
                  >
                    <span className="booking-choice__title">{v.plateNumber}</span>
                    {v.isDefault && <span className="booking-choice__badge">Основное</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button type="button" block disabled={!vehicleId} onClick={() => setStep("main")}>
            Далее
          </Button>
        </section>
      )}

      {step === "main" && (
        <section className="booking-step">
          <h2 className="ui-title-sm">Основная услуга</h2>
          <ul className="booking-list">
            {mainServices.map((s) => {
              const price = catalog ? priceOf(catalog, s.id, classId, "services") : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`booking-choice${mainId === s.id ? " booking-choice--on" : ""}`}
                    onClick={() => setMainId(s.id)}
                  >
                    <span className="booking-choice__title">{s.name}</span>
                    <span className="booking-choice__meta">
                      {s.durationMinutes ?? 60} мин
                      {price != null ? ` · ${formatRub(price)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!mainServices.length && <p className="booking-hint">Нет услуг с ценой для этого класса.</p>}
          <div className="booking-nav">
            <Button type="button" variant="ghost" onClick={() => setStep("vehicle")}>
              Назад
            </Button>
            <Button type="button" disabled={!mainId} onClick={() => setStep("addons")}>
              Далее
            </Button>
          </div>
        </section>
      )}

      {step === "addons" && (
        <section className="booking-step">
          <h2 className="ui-title-sm">Доп.услуги</h2>
          <p className="booking-hint">Можно пропустить или выбрать несколько.</p>
          <ul className="booking-list">
            {addonServices.map((s) => {
              const price = catalog ? priceOf(catalog, s.id, classId, "extra-services") : null;
              const on = addonIds.includes(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`booking-choice${on ? " booking-choice--on" : ""}`}
                    onClick={() => toggleAddon(s.id)}
                  >
                    <span className="booking-choice__title">{s.name}</span>
                    <span className="booking-choice__meta">
                      {s.durationMinutes ?? 15} мин
                      {price != null ? ` · ${formatRub(price)}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="booking-nav">
            <Button type="button" variant="ghost" onClick={() => setStep("main")}>
              Назад
            </Button>
            <Button type="button" onClick={() => setStep("datetime")}>
              Далее
            </Button>
          </div>
        </section>
      )}

      {step === "datetime" && (
        <section className="booking-step">
          <h2 className="ui-title-sm">Дата и время</h2>
          <p className="booking-hint">
            Длительность ~{durationMinutes} мин · {formatRub(totalKopecks)}
          </p>
          <div className="booking-dates">
            {dates.map((d) => (
              <button
                key={d}
                type="button"
                className={`booking-date${date === d ? " booking-date--on" : ""}`}
                onClick={() => setDate(d)}
              >
                {formatDateLabel(d)}
              </button>
            ))}
          </div>
          {slotsLoading ? (
            <p className="price-loading">Слоты…</p>
          ) : (
            <div className="booking-slots">
              {slots.map((s) => (
                <button
                  key={s.startsAt}
                  type="button"
                  className={`booking-slot${startsAt === s.startsAt ? " booking-slot--on" : ""}`}
                  onClick={() => setStartsAt(s.startsAt)}
                >
                  {s.time}
                </button>
              ))}
              {!slots.length && <p className="booking-hint">Нет свободных слотов на этот день.</p>}
            </div>
          )}
          <div className="booking-nav">
            <Button type="button" variant="ghost" onClick={() => setStep("addons")}>
              Назад
            </Button>
            <Button type="button" disabled={!startsAt || saving} onClick={() => void confirm()}>
              {saving ? "Запись…" : "Записаться"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ButtonLinkLike({ to }: { to: string }) {
  return (
    <Link className="ui-btn ui-btn--secondary ui-btn--block" to={to} style={{ marginTop: 12 }}>
      В кабинет
    </Link>
  );
}
