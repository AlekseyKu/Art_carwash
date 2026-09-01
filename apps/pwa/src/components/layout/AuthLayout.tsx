import type { ReactNode } from "react";

export interface AuthLayoutProps {
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, lead, children, footer }: AuthLayoutProps) {
  return (
    <div className="app-main ui-auth-page">
      <h1 className="ui-title">{title}</h1>
      {lead && <p className="ui-auth-page__lead">{lead}</p>}
      {children}
      {footer}
    </div>
  );
}
