export interface ExpandingLabelProps {
  label: string;
  expanded: boolean;
}

const LABEL_MAX = "5.75rem";

export function ExpandingLabel({ label, expanded }: ExpandingLabelProps) {
  return (
    <span
      className={["bottom-nav__label", expanded ? "bottom-nav__label--expanded" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--bottom-nav-label-max" as string]: LABEL_MAX }}
      aria-hidden={!expanded}
    >
      {label}
    </span>
  );
}
