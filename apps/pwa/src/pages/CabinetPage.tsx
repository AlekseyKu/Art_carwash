import { useAuth } from "../auth";
import { PageHeader } from "../components/layout/PageHeader";
import { Button, Card, InfoRow, StubPanel } from "../components/ui";

function GarageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 10 12 4l8 6v10H4V10Z" strokeLinejoin="round" />
      <path d="M9 20v-6h6v6" strokeLinecap="round" />
    </svg>
  );
}

export function CabinetPage() {
  const { customer, logout } = useAuth();

  return (
    <div>
      <PageHeader title="Кабинет" subtitle="Ваш аккаунт и записи" />

      <Card className="profile-card">
        <InfoRow label="Телефон" value={customer?.phoneDisplay ?? customer?.phone ?? "—"} />
        {customer?.name && <InfoRow label="Имя" value={customer.name} />}
      </Card>

      <StubPanel title="Гараж и история" icon={<GarageIcon />}>
        <p className="stub-panel__text">Список автомобилей и история визитов появятся в фазе B.</p>
      </StubPanel>

      <div className="page-actions">
        <Button type="button" variant="secondary" block onClick={() => void logout()}>
          Выйти
        </Button>
      </div>
    </div>
  );
}
