import { Link } from "react-router-dom";
import { OnboardingLayout } from "../components/layout/OnboardingLayout";
import { ButtonLink, Card } from "../components/ui";

const features = [
  {
    title: "Прайс",
    text: "Актуальные цены по классу авто",
  },
  {
    title: "Запись",
    text: "Выберите удобное время на мойку",
  },
  {
    title: "Кабинет",
    text: "Ваши авто и история посещений",
  },
] as const;

export function WelcomePage() {
  return (
    <OnboardingLayout
      title="Автомойка у ЖД"
      footer={
        <>
          <ButtonLink to="/register" block>
            Далее
          </ButtonLink>
          <p className="ui-link-row">
            <Link className="ui-link" to="/login">
              У меня уже есть аккаунт
            </Link>
          </p>
        </>
      }
    >
      <Card>
        <ul className="welcome-list">
          {features.map((item) => (
            <li key={item.title} className="welcome-list__item">
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </OnboardingLayout>
  );
}
