import { useAuth } from "../auth";

export function CabinetPage() {
  const { customer, logout } = useAuth();

  return (
    <div>
      <h1 style={{ marginTop: 0, fontSize: 22 }}>Кабинет</h1>
      <div className="card">
        <p style={{ margin: "0 0 4px", color: "var(--muted)", fontSize: 13 }}>Телефон</p>
        <p style={{ margin: 0, fontWeight: 600 }}>{customer?.phoneDisplay ?? customer?.phone}</p>
      </div>
      <div className="stub-page">
        <h2>Гараж и история</h2>
        <p>Будут доступны в фазе B.</p>
      </div>
      <button type="button" className="btn btn-secondary btn-block" onClick={() => void logout()}>
        Выйти
      </button>
    </div>
  );
}
