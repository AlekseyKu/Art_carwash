import { AppMark } from "../brand/AppMark";

export function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-screen__pattern" aria-hidden />
      <div className="splash-screen__content">
        <div className="splash-mark" aria-hidden>
          <AppMark className="splash-mark__logo" />
        </div>
        <h1 className="splash-screen__title">Автомойка у ЖД</h1>
        <p className="splash-screen__city">г. Ступино</p>
      </div>
    </div>
  );
}
