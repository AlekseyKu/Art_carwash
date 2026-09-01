import type { ReactNode } from "react";

export interface OwnerLayoutProps {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function OwnerLayout({ title, lead, children, footer }: OwnerLayoutProps) {
  return (
    <div className="owner-layout">
      <div className="app-main owner-layout__body">
        <h1 className="owner-layout__title">{title}</h1>
        {lead && <p className="owner-layout__lead">{lead}</p>}
        {children}
      </div>
      {footer && <div className="app-main">{footer}</div>}
    </div>
  );
}
