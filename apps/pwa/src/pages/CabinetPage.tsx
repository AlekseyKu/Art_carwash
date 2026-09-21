import { useEffect, useMemo, useState } from "react";
import { PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { apiClient, type BookingDto, type Vehicle } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/layout/PageHeader";
import { Button, Card, Field, FormError, InfoRow, Input } from "../components/ui";
import { vehicleClassIconSrc } from "../vehicleClassIcons";

type VehicleDraft = {
  plateNumber: string;
  classId: string;
  isDefault: boolean;
};

const emptyDraft = (classId = ""): VehicleDraft => ({
  plateNumber: "",
  classId,
  isDefault: false,
});

function bookingStatusLabel(status: string) {
  switch (status) {
    case "booked":
      return "Забронировано";
    case "arrived":
      return "На мойке";
    case "in_service":
      return "В работе";
    case "completed":
      return "Выполнено";
    case "cancelled":
      return "Отменено";
    case "no_show":
      return "Неявка";
    default:
      return status;
  }
}

function formatBookingWhen(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function CabinetPage() {
  const { customer, logout, updateProfile } = useAuth();
  const [name, setName] = useState(customer?.name ?? "");
  const [nameEditing, setNameEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookings, setBookings] = useState<BookingDto[]>([]);
  const [classes, setClasses] = useState<
    { id: string; name: string; iconKey: string; slug: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookingActionId, setBookingActionId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>(emptyDraft());
  const [formError, setFormError] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formDeleting, setFormDeleting] = useState(false);

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of classes) map.set(c.id, c.name);
    return map;
  }, [classes]);

  const classMetaById = useMemo(() => {
    const map = new Map<string, { iconKey: string; slug: string }>();
    for (const c of classes) map.set(c.id, { iconKey: c.iconKey || c.slug, slug: c.slug });
    return map;
  }, [classes]);

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [v, catalog, b] = await Promise.all([
        apiClient.listVehicles(),
        apiClient.catalog(),
        apiClient.listBookings(),
      ]);
      setVehicles(v.vehicles);
      setBookings(b.bookings);
      setClasses(
        catalog.vehicleClasses
          .filter((c) => c.active)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => ({ id: c.id, name: c.name, iconKey: c.iconKey, slug: c.slug }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить кабинет");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!nameEditing) setName(customer?.name ?? "");
  }, [customer?.name, nameEditing]);

  useEffect(() => {
    if (!profileMsg) return;
    const t = window.setTimeout(() => setProfileMsg(false), 3000);
    return () => window.clearTimeout(t);
  }, [profileMsg]);

  async function onSaveProfile(e?: React.FormEvent) {
    e?.preventDefault();
    if (!nameEditing) return;
    setProfileError("");
    setProfileSaving(true);
    try {
      const trimmed = name.trim();
      await updateProfile(trimmed === "" ? null : trimmed);
      setNameEditing(false);
      setProfileMsg(true);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setProfileSaving(false);
    }
  }

  function startNameEdit() {
    setProfileError("");
    setProfileMsg(false);
    setNameEditing(true);
  }

  function openCreate() {
    if (!classes.length) {
      setError("Нет классов авто в каталоге. Опубликуйте каталог с кассы в облако.");
      return;
    }
    setError("");
    setEditingId(null);
    setDraft(emptyDraft(classes[0]?.id ?? ""));
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(v: Vehicle) {
    setEditingId(v.id);
    setDraft({
      plateNumber: v.plateNumber,
      classId: v.classId,
      isDefault: v.isDefault,
    });
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError("");
  }

  async function onSaveVehicle(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setFormSaving(true);
    try {
      const body = {
        plateNumber: draft.plateNumber,
        classId: draft.classId,
        isDefault: draft.isDefault,
      };
      if (editingId) {
        await apiClient.updateVehicle(editingId, body);
      } else {
        await apiClient.createVehicle(body);
      }
      closeForm();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setFormSaving(false);
    }
  }

  async function onDeleteFromForm() {
    if (!editingId) return;
    if (!window.confirm("Удалить автомобиль из гаража?")) return;
    setFormError("");
    setFormDeleting(true);
    try {
      await apiClient.deleteVehicle(editingId);
      closeForm();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setFormDeleting(false);
    }
  }

  async function onCancelBooking() {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    setError("");
    setBookingActionId(id);
    try {
      await apiClient.cancelBooking(id);
      setCancelTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить");
    } finally {
      setBookingActionId(null);
    }
  }

  const upcomingBookings = useMemo(() => {
    const now = Date.now();
    return bookings
      .filter((b) => b.status === "booked" && new Date(b.startsAt).getTime() >= now - 60_000)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [bookings]);

  const pastBookings = useMemo(() => {
    const upcomingIds = new Set(upcomingBookings.map((b) => b.id));
    return bookings
      .filter((b) => !upcomingIds.has(b.id))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }, [bookings, upcomingBookings]);

  return (
    <div>
      <PageHeader title="Кабинет" subtitle="Профиль, гараж и записи" />

      <Card className="profile-card">
        {!nameEditing ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Изменить имя"
            onClick={startNameEdit}
          >
            <PencilSquareIcon />
          </button>
        ) : (
          <button
            type="button"
            className="profile-card__save"
            disabled={profileSaving}
            onClick={() => void onSaveProfile()}
          >
            {profileSaving ? "…" : "Сохранить"}
          </button>
        )}
        <InfoRow label="Телефон" value={customer?.phoneDisplay ?? customer?.phone ?? "—"} />
        <div className="profile-name-form">
          <div className="profile-name-label-row">
            <label className="ui-field__label" htmlFor="profile-name">
              Имя
            </label>
            {profileMsg && <span className="profile-save-ok">Сохранено</span>}
          </div>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как к вам обращаться"
            autoComplete="name"
            readOnly={!nameEditing}
            className={nameEditing ? "" : "profile-name-input--readonly"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameEditing) {
                e.preventDefault();
                void onSaveProfile();
              }
            }}
          />
          <FormError message={profileError} />
        </div>
      </Card>

      <FormError message={error} />

      <section className="garage-section">
        <div className="garage-section__head">
          <h2 className="ui-title-sm garage-section__title">Гараж</h2>
          <Button type="button" variant="secondary" onClick={openCreate} disabled={loading}>
            Добавить
          </Button>
        </div>

        {loading && <p className="price-loading">Загрузка…</p>}

        {!loading && !vehicles.length && (
          <Card className="garage-empty">
            <p className="garage-empty__text">Пока нет автомобилей. Добавьте первое авто в гараж.</p>
          </Card>
        )}

        <ul className="garage-list">
          {vehicles.map((v) => {
            const meta = classMetaById.get(v.classId);
            const icon = meta ? vehicleClassIconSrc(meta.iconKey || meta.slug) : undefined;
            return (
              <li key={v.id}>
                <Card className={`garage-card${v.isDefault ? " garage-card--default" : ""}`}>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Изменить авто"
                    onClick={() => openEdit(v)}
                  >
                    <PencilSquareIcon />
                  </button>
                  <div className="garage-card__main">
                    {icon ? (
                      <span
                        className="garage-card__icon"
                        style={{
                          WebkitMaskImage: `url(${icon})`,
                          maskImage: `url(${icon})`,
                        }}
                        aria-hidden
                      />
                    ) : (
                      <span className="garage-card__icon garage-card__icon--empty" aria-hidden />
                    )}
                    <div className="garage-card__body">
                      <div className="garage-card__plate">
                        {v.plateNumber}
                        {v.isDefault && <span className="garage-card__badge">Основное</span>}
                      </div>
                      <div className="garage-card__meta">
                        {classNameById.get(v.classId) ?? "Класс"}
                      </div>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="bookings-section">
        <div className="garage-section__head">
          <h2 className="ui-title-sm garage-section__title">Мои записи</h2>
          <Link className="ui-btn ui-btn--secondary" to="/app/booking">
            Записаться
          </Link>
        </div>

        {!loading && !bookings.length && (
          <Card className="garage-empty">
            <p className="garage-empty__text">Пока нет записей. Запишитесь на мойку онлайн.</p>
          </Card>
        )}

        {upcomingBookings.length > 0 && (
          <>
            <h3 className="bookings-subtitle">Предстоящие</h3>
            <ul className="garage-list">
              {upcomingBookings.map((b) => {
                const main = b.items.find((i) => i.kind === "main") ?? b.items[0];
                const addons = b.items.filter((i) => i.kind === "addon");
                return (
                  <li key={b.id}>
                    <Card className="booking-card">
                      <div className="booking-card__when">{formatBookingWhen(b.startsAt)}</div>
                      <div className="booking-card__plate">{b.plateNumber ?? "Авто"}</div>
                      <div className="booking-card__meta">
                        {main?.serviceName ?? "Услуга"}
                        {addons.length ? ` · +${addons.length}` : ""}
                        {" · "}
                        {bookingStatusLabel(b.status)}
                      </div>
                      <button
                        type="button"
                        className="booking-card__cancel"
                        disabled={bookingActionId === b.id}
                        onClick={() => setCancelTarget(b)}
                      >
                        {bookingActionId === b.id ? "Отмена…" : "Отменить запись"}
                      </button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {pastBookings.length > 0 && (
          <>
            <h3 className="bookings-subtitle">История</h3>
            <ul className="garage-list">
              {pastBookings.map((b) => {
                const main = b.items.find((i) => i.kind === "main") ?? b.items[0];
                return (
                  <li key={b.id}>
                    <Card className="booking-card booking-card--past">
                      <div className="booking-card__when">{formatBookingWhen(b.startsAt)}</div>
                      <div className="booking-card__plate">{b.plateNumber ?? "Авто"}</div>
                      <div className="booking-card__meta">
                        {main?.serviceName ?? "Услуга"} · {bookingStatusLabel(b.status)}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {cancelTarget && (
        <div
          className="garage-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-booking-title"
        >
          <button
            type="button"
            className="garage-modal__backdrop"
            aria-label="Закрыть"
            onClick={() => setCancelTarget(null)}
          />
          <Card className="garage-modal__panel garage-modal__panel--confirm">
            <h2 id="cancel-booking-title" className="ui-title-sm garage-modal__title">
              Отменить запись?
            </h2>
            <p className="garage-modal__text">
              Запись на <strong>{formatBookingWhen(cancelTarget.startsAt)}</strong>
              {cancelTarget.plateNumber ? (
                <>
                  {" "}
                  · {cancelTarget.plateNumber}
                </>
              ) : null}{" "}
              будет отменена.
            </p>
            <div className="garage-modal__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={bookingActionId === cancelTarget.id}
                onClick={() => setCancelTarget(null)}
              >
                Оставить
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={bookingActionId === cancelTarget.id}
                onClick={() => void onCancelBooking()}
              >
                {bookingActionId === cancelTarget.id ? "Отмена…" : "Да, отменить"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {formOpen && (
        <div className="garage-modal" role="dialog" aria-modal="true" aria-labelledby="garage-form-title">
          <button type="button" className="garage-modal__backdrop" aria-label="Закрыть" onClick={closeForm} />
          <Card className="garage-modal__panel">
            <button
              type="button"
              className="icon-btn garage-modal__close"
              aria-label="Закрыть"
              onClick={closeForm}
            >
              <XMarkIcon />
            </button>
            <h2 id="garage-form-title" className="ui-title-sm garage-modal__title">
              {editingId ? "Редактировать авто" : "Добавить авто"}
            </h2>
            <form onSubmit={onSaveVehicle}>
              <Field
                label="Госномер"
                htmlFor="plate"
                inputProps={{
                  value: draft.plateNumber,
                  onChange: (e) =>
                    setDraft((d) => ({ ...d, plateNumber: e.target.value.toUpperCase() })),
                  placeholder: "А170РТ90",
                  required: true,
                  autoCapitalize: "characters",
                }}
              />
              <Field label="Класс" htmlFor="classId">
                <select
                  id="classId"
                  className="ui-input"
                  value={draft.classId}
                  onChange={(e) => setDraft((d) => ({ ...d, classId: e.target.value }))}
                  required
                >
                  {!draft.classId && <option value="">Выберите класс</option>}
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="ui-checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
                />
                <span className="ui-checkbox-row__text">Сделать основным</span>
              </label>
              <FormError message={formError} />
              <div className="garage-modal__actions">
                {editingId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={formSaving || formDeleting}
                    onClick={() => void onDeleteFromForm()}
                  >
                    {formDeleting ? "Удаление…" : "Удалить"}
                  </Button>
                ) : null}
                <Button type="submit" disabled={formSaving || formDeleting}>
                  {formSaving ? "Сохранение…" : "Сохранить"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <div className="page-actions">
        <Button type="button" variant="secondary" block onClick={() => void logout()}>
          Выйти
        </Button>
      </div>
    </div>
  );
}
