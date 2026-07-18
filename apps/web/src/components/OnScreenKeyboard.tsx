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
  if (!ctx) throw new Error("useTouchKeyboard вне TouchKeyboardProvider");
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
}: FieldProps) {
  const kb = useTouchKeyboard();
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

  useEffect(() => {
    setValue(session.value);
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function commit(next: string) {
    setValue(next);
    session.onChange(next);
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
          </div>
          <button type="button" className="btn-primary" onClick={onClose}>
            Готово
          </button>
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
