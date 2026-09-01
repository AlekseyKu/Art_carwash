import { LOGO_APP_PATH } from "../../brand/logo";

export function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-screen__pattern" aria-hidden />
      <div className="splash-screen__content">
        <div className="splash-mark" aria-hidden>
          <img className="splash-mark__logo" src={LOGO_APP_PATH} alt="" />
        </div>
        <h1 className="splash-screen__title">Автомойка у ЖД</h1>
        <p className="splash-screen__city">г. Ступино</p>
      </div>
    </div>
  );
}
