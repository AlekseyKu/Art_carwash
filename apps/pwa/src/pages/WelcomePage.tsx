import { Link } from "react-router-dom";

export function WelcomePage() {
  return (
    <div className="app-main" style={{ paddingTop: 32 }}>
      <h1 style={{ marginTop: 0 }}>Автомойка у ЖД</h1>
      <div className="card" style={{ marginBottom: 16 }}>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <strong>Прайс</strong> — актуальные цены по классу авто
          </li>
          <li>
            <strong>Запись</strong> — выберите время на мойку
          </li>
          <li>
            <strong>Кабинет</strong> — ваши авто и история
          </li>
        </ul>
      </div>
      <Link to="/register" className="btn btn-primary btn-block">
        Далее
      </Link>
      <p style={{ textAlign: "center", marginTop: 16 }}>
        <Link to="/login">У меня уже есть аккаунт</Link>
      </p>
    </div>
  );
}
