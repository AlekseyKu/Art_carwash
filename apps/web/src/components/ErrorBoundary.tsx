import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Подпись зоны (касса / админ) */
  label?: string;
};

type State = {
  error: Error | null;
};

/**
 * Ловит падения React-рендера → экран восстановления вместо белого окна.
 * На кассе без F5: «На главную» / «Повторить».
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label ?? "app", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  private goHome = () => {
    this.setState({ error: null });
    const base = window.location.href.split("#")[0];
    window.location.replace(`${base}#/`);
  };

  render() {
    if (this.state.error) {
      return (
        <div className="app-shell">
          <main className="content" style={{ display: "grid", placeItems: "center" }}>
            <div className="panel stack" style={{ width: "min(480px, 100%)", textAlign: "center" }}>
              <h1 className="h1" style={{ fontSize: "1.35rem" }}>
                Что-то пошло не так
              </h1>
              <p className="muted" style={{ margin: 0 }}>
                {this.props.label ? `${this.props.label}: ` : ""}
                экран восстановлен. Можно продолжить работу.
              </p>
              <p
                className="muted"
                style={{ fontSize: "0.8rem", wordBreak: "break-word", margin: 0 }}
              >
                {this.state.error.message}
              </p>
              <div className="row" style={{ justifyContent: "center" }}>
                <button type="button" className="btn-primary" onClick={this.reset}>
                  Повторить
                </button>
                <button type="button" className="btn-secondary" onClick={this.goHome}>
                  На кассу
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}
