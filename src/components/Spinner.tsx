import type { HTMLAttributes } from "react";

interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md";
  label?: string;
}

export function Spinner({ size = "md", label, className, ...props }: SpinnerProps) {
  const sizeClass = size === "sm" ? "spinner-sm" : "spinner-md";
  return (
    <div className={`spinner-wrapper ${className ?? ""}`} {...props}>
      <div className={`spinner ${sizeClass}`} aria-hidden="true" />
      {label ? <span className="spinner-label">{label}</span> : null}
    </div>
  );
}
