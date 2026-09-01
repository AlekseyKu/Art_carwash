import type { ReactNode } from "react";

export interface OnboardingLayoutProps {
  title: string;
  lead?: string;
  children: ReactNode;
  footer: ReactNode;
}

export function OnboardingLayout({ title, lead, children, footer }: OnboardingLayoutProps) {
  return (
    <div className="onboarding-layout">
      <div className="app-main onboarding-layout__body">
        <h1 className="ui-title onboarding-layout__title">{title}</h1>
        {lead && <p className="onboarding-layout__lead">{lead}</p>}
        {children}
      </div>
      <div className="app-main onboarding-layout__footer">{footer}</div>
    </div>
  );
}
