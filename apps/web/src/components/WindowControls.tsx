type Props = {
  visible?: boolean;
};

/** Кнопки свернуть/закрыть — только в Electron (desktop: true). */
export function WindowControls({ visible = true }: Props) {
  if (!visible) return null;

  return (
    <div className="window-controls" role="group" aria-label="Окно">
      <button
        type="button"
        className="window-btn window-btn-min"
        title="Свернуть"
        aria-label="Свернуть"
        onClick={() => {
          void fetch("/api/desktop/minimize", { method: "POST" }).catch(() => undefined);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="window-btn window-btn-close"
        title="Закрыть"
        aria-label="Закрыть"
        onClick={() => {
          if (!window.confirm("Закрыть кассу?")) return;
          void fetch("/api/desktop/close", { method: "POST" }).catch(() => undefined);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M3 3l8 8M11 3L3 11"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
