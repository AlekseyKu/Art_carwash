import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  dismissInstallHint,
  isInstallHintDismissed,
  isIosBrowser,
  isStandalonePwa,
} from "../../pwaPlatform";

const HINT_ROUTES = new Set(["/welcome", "/login", "/register"]);

export function InstallHint() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!HINT_ROUTES.has(pathname)) {
      setVisible(false);
      return;
    }
    if (isStandalonePwa() || !isIosBrowser() || isInstallHintDismissed()) {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, [pathname]);

  if (!visible) return null;

  function onDismiss() {
    dismissInstallHint();
    setVisible(false);
  }

  return (
    <div className="install-hint" role="note" aria-live="polite">
      <div className="install-hint__header">
        <span className="install-hint__icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="2" width="14" height="20" rx="2" />
            <path d="M12 18h.01" strokeLinecap="round" />
          </svg>
        </span>
        <strong className="install-hint__title">Установить как приложение</strong>
        <button type="button" className="install-hint__close" onClick={onDismiss} aria-label="Закрыть">
          ×
        </button>
      </div>
      <p className="install-hint__text">
        Нажмите «Поделиться» (□↑) в Safari → «На экран &quot;Домой&quot;» → «Добавить». Так
        приложение откроется с иконки без адресной строки.
      </p>
    </div>
  );
}
