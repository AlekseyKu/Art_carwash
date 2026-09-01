export function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-screen__pattern" aria-hidden />
      <div className="splash-screen__content">
        <div className="splash-mark" aria-hidden>
          <div className="splash-mark__icon">
            <svg viewBox="0 0 40 40" fill="none" aria-hidden>
              <path
                d="M20 6c-1.2 4.8-6 8.8-6 14.2 0 3.3 2.7 6 6 6s6-2.7 6-6c0-5.4-4.8-9.4-6-14.2Z"
                fill="currentColor"
                opacity="0.95"
              />
              <path
                d="M12 28h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.5"
              />
            </svg>
          </div>
        </div>
        <h1 className="splash-screen__title">Автомойка у ЖД</h1>
        <p className="splash-screen__city">г. Ступино</p>
      </div>
    </div>
  );
}
