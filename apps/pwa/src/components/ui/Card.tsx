import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={["ui-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
