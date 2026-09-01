import type { ReactNode } from "react";
import { Input, type InputProps } from "./Input";

export interface FieldProps {
  label: string;
  htmlFor: string;
  children?: ReactNode;
  inputProps?: InputProps;
}

export function Field({ label, htmlFor, children, inputProps }: FieldProps) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children ?? <Input id={htmlFor} {...inputProps} />}
    </div>
  );
}

export interface CheckboxFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  required?: boolean;
  children: ReactNode;
}

export function CheckboxField({ checked, onChange, required, children }: CheckboxFieldProps) {
  return (
    <label className="ui-checkbox-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
      />
      <span className="ui-checkbox-row__text">{children}</span>
    </label>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="ui-form-error" role="alert">{message}</p>;
}
