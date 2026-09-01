import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", ...rest },
  ref
) {
  return <input ref={ref} className={["ui-input", className].filter(Boolean).join(" ")} {...rest} />;
});
