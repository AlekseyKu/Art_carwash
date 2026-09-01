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
      lead="Прайс, запись и личный кабинет — в одном приложении"
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
          {features.map((item, index) => (
            <li key={item.title} className="welcome-list__item">
              <span className="welcome-list__badge" aria-hidden>
                {index + 1}
              </span>
              <div className="welcome-list__body">
                <div className="welcome-list__title">{item.title}</div>
                <div className="welcome-list__text">{item.text}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </OnboardingLayout>
  );
}
