import type { ReactNode } from "react";
import { Card } from "./Card";

export interface StubPanelProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

function DefaultStubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
    </svg>
  );
}

export function StubPanel({ title, children, action, icon }: StubPanelProps) {
  return (
    <Card className="stub-panel">
      <div className="stub-panel__icon">{icon ?? <DefaultStubIcon />}</div>
      <h2 className="stub-panel__title">{title}</h2>
      <div className="stub-panel__body">{children}</div>
      {action && <div className="stub-panel__action">{action}</div>}
    </Card>
  );
}
