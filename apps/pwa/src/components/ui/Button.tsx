import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

type Variant = "primary" | "secondary" | "ghost";

function buttonClasses(variant: Variant, block: boolean, className: string) {
  return ["ui-btn", `ui-btn--${variant}`, block ? "ui-btn--block" : "", className]
    .filter(Boolean)
    .join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  block = false,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, block, className)} {...rest}>
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends Omit<LinkProps, "className"> {
  variant?: Variant;
  block?: boolean;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  variant = "primary",
  block = false,
  className = "",
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, block, className)} {...rest}>
      {children}
    </Link>
  );
}
