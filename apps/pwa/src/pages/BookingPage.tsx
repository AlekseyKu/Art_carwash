import { PageHeader } from "../components/layout/PageHeader";
import { StubPanel } from "../components/ui";

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

export function BookingPage() {
  return (
    <div>
      <PageHeader title="Запись" subtitle="Онлайн-запись на мойку" />
      <StubPanel title="Скоро" icon={<CalendarIcon />}>
        <p className="stub-panel__text">Онлайн-запись появится в следующем обновлении (фаза C).</p>
        <p className="stub-panel__text">
          Пока запишитесь по телефону из раздела «Прайс → О мойке».
        </p>
      </StubPanel>
    </div>
  );
}
