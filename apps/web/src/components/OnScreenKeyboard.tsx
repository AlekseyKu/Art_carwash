import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type KeyboardMode = "text" | "numeric" | "pin" | "ascii";

type KbSession = {
  mode: KeyboardMode;
  title?: string;
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  /** Стартовая раскладка для text */
  layout?: "ru" | "en";
};

type KbApi = {
  open: (session: KbSession) => void;
  close: () => void;
};

const KbContext = createContext<KbApi | null>(null);

export function useTouchKeyboard() {
  const ctx = useContext(KbContext);
  if (!ctx) {
    // Не роняем весь экран: no-op клавиатура
    return {
      open: () => {
        console.warn("useTouchKeyboard: нет TouchKeyboardProvider");
      },
      close: () => undefined,
    };
  }
  return ctx;
}

const RU_ROWS = [
  ["й", "ц", "у", "к", "е", "н", "г", "ш", "щ", "з", "х", "ъ"],
  ["ф", "ы", "в", "а", "п", "р", "о", "л", "д", "ж", "э"],
  ["я", "ч", "с", "м", "и", "т", "ь", "б", "ю"],
];

const EN_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const SYMBOLS = [".", ":", "/", "-", "_", "@", "#", "%", "+", "="];

type FieldProps = {
  value: string;
  onChange: (next: string) => void;
  mode?: KeyboardMode;
  title?: string;
  placeholder?: string;
  maxLength?: number;
  layout?: "ru" | "en";
  className?: string;
  style?: CSSProperties;
  /** Маскировать ввод (PIN / token) */
  secret?: boolean;
  /**
   * false — обычный input (удобно вставлять длинный token / URL).
   * По умолчанию true — экранная клавиатура.
   */
  keyboard?: boolean;
};

export function TouchField({
  value,
  onChange,
  mode = "text",
  title,
  placeholder = "",
  maxLength,
  layout,
  className = "",
  style,
  secret = false,
  keyboard = true,
}: FieldProps) {
  const kb = useTouchKeyboard();
  if (!keyboard) {
    const inputType =
      secret ? "password" : mode === "pin" || mode === "numeric" ? "text" : "text";
    const inputMode =
      mode === "pin" ? "numeric" : mode === "numeric" ? "decimal" : mode === "ascii" ? "url" : "text";
    return (
      <input
        className={`touch-field touch-field-input${className ? ` ${className}` : ""}`}
        style={style}
        type={inputType}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        title={title}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          let next = e.target.value;
          if (mode === "pin") next = next.replace(/\D/g, "");
          else if (mode === "numeric") next = next.replace(/[^\d.,]/g, "");
          else if (mode === "ascii") next = next.replace(/[^\x20-\x7E]/g, "");
          if (maxLength != null) next = next.slice(0, maxLength);
          onChange(next);
        }}
      />
    );
  }
  const shown =
    secret && value ? "•".repeat(Math.min(value.length, 24)) : value || placeholder;
  return (
    <button
      type="button"
      className={`touch-field${!value ? " placeholder" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      onClick={() =>
        kb.open({
          mode,
          title: title ?? placeholder,
          value,
          onChange,
          maxLength,
          layout: layout ?? (mode === "ascii" ? "en" : "ru"),
        })
      }
    >
      {shown}
    </button>
  );
}

function KeyboardPanel({
  session,
  onClose,
}: {
  session: KbSession;
  onClose: () => void;
}) {
  const [value, setValue] = useState(session.value);
  const [layout, setLayout] = useState<"ru" | "en">(
    session.layout ?? (session.mode === "ascii" ? "en" : "ru")
  );
  const [pasteError, setPasteError] = useState("");

  useEffect(() => {
    setValue(session.value);
    setPasteError("");
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function commit(next: string) {
    let out = next;
    if (session.maxLength != null && out.length > session.maxLength) {
      out = out.slice(0, session.maxLength);
    }
    setValue(out);
    session.onChange(out);
  }

  function append(ch: string) {
    if (session.maxLength != null && value.length >= session.maxLength) return;
    const mode = session.mode;
    if (mode === "pin" && !/^\d$/.test(ch)) return;
    if (mode === "numeric") {
      if (ch === "." || ch === ",") {
        if (value.includes(".") || value.includes(",")) return;
        commit(value + ".");
        return;
      }
      if (!/^\d$/.test(ch)) return;
    }
    commit(value + ch);
  }

  function backspace() {
    commit(value.slice(0, -1));
  }

  function applyPastedText(raw: string) {
    const text = String(raw || "").replace(/\s+/g, "").trim();
    if (!text) {
      setPasteError("Буфер обмена пуст");
      return;
    }
    const mode = session.mode;
    let next = text;
    if (mode === "pin") next = text.replace(/\D/g, "");
    else if (mode === "numeric") next = text.replace(/[^\d.,]/g, "").replace(",", ".");
    else if (mode === "ascii") next = text.replace(/[^\x20-\x7E]/g, "");
    if (!next) {
      setPasteError("В буфере нет подходящего текста");
      return;
    }
    setPasteError("");
    commit(next);
  }

  async function pasteFromClipboard() {
    setPasteError("");
    try {
      if (!navigator.clipboard?.readText) {
        setPasteError("Вставка недоступна в этой среде");
        return;
      }
      const text = await navigator.clipboard.readText();
      applyPastedText(text);
    } catch {
      setPasteError("Не удалось прочитать буфер — разрешите доступ к буферу обмена");
    }
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text) return;
      e.preventDefault();
      applyPastedText(text);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // session/value intentionally via applyPastedText closure refresh each render
  });

  const letterMode = session.mode === "text" || session.mode === "ascii";
  const rows = layout === "ru" ? RU_ROWS : EN_ROWS;
  const showSymbols = session.mode === "ascii" || layout === "en";

  return (
    <div className="osk-backdrop" onClick={onClose}>
      <div
        className="osk-panel"
        role="dialog"
        aria-label={session.title ?? "Клавиатура"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="osk-header">
          <div>
            {session.title && (
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                {session.title}
              </div>
            )}
            <div className="osk-value">{value || <span className="muted">…</span>}</div>
            {pasteError ? (
              <div style={{ color: "var(--danger)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
                {pasteError}
              </div>
            ) : null}
          </div>
          <div className="osk-header-actions">
            <button type="button" className="btn-secondary" onClick={() => void pasteFromClipboard()}>
              Вставить
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Готово
            </button>
          </div>
        </div>

        {letterMode ? (
          <div className="osk-keys">
            <div className="osk-row">
              {DIGITS.map((k) => (
                <button key={k} type="button" className="osk-key" onClick={() => append(k)}>
                  {k}
                </button>
              ))}
            </div>
            {showSymbols && (
              <div className="osk-row">
                {SYMBOLS.map((k) => (
                  <button key={k} type="button" className="osk-key" onClick={() => append(k)}>
                    {k}
                  </button>
                ))}
              </div>
            )}
            {rows.map((row, i) => (
              <div key={i} className="osk-row">
                {row.map((k) => (
                  <button key={k} type="button" className="osk-key" onClick={() => append(k)}>
                    {k}
                  </button>
                ))}
              </div>
            ))}
            <div className="osk-row">
              {session.mode === "text" && (
                <button
                  type="button"
                  className="osk-key osk-key-wide"
                  onClick={() => setLayout((l) => (l === "ru" ? "en" : "ru"))}
                >
                  {layout === "ru" ? "EN" : "РУ"}
                </button>
              )}
              <button type="button" className="osk-key osk-key-wide" onClick={() => append(" ")}>
                Пробел
              </button>
              <button type="button" className="osk-key osk-key-wide" onClick={backspace}>
                ⌫
              </button>
            </div>
          </div>
        ) : (
          <div className="osk-keys osk-keys-numeric">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", session.mode === "numeric" ? "." : "C", "0", "⌫"].map(
              (k) => (
                <button
                  key={k}
                  type="button"
                  className="osk-key osk-key-num"
                  onClick={() => {
                    if (k === "⌫") backspace();
                    else if (k === "C") commit("");
                    else append(k);
                  }}
                >
                  {k}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function TouchKeyboardProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<KbSession | null>(null);

  const open = useCallback((s: KbSession) => setSession(s), []);
  const close = useCallback(() => setSession(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);

  return (
    <KbContext.Provider value={api}>
      {children}
      {session && <KeyboardPanel session={session} onClose={close} />}
    </KbContext.Provider>
  );
}
