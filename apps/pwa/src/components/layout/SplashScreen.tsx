import { AppMark } from "../brand/AppMark";

export function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-screen__pattern" aria-hidden />
      <div className="splash-screen__content">
        <AppMark className="splash-screen__logo" />
        <h1 className="splash-screen__title">Автомойка у ЖД</h1>
        <p className="splash-screen__city">Ступино</p>
      </div>
    </div>
  );
}
