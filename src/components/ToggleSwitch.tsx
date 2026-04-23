import type { InputHTMLAttributes } from "react";

interface ToggleSwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  size?: "standard" | "compact";
  onLabel?: string;
  offLabel?: string;
}

export function ToggleSwitch({
  size = "standard",
  onLabel,
  offLabel,
  checked,
  disabled,
  className,
  ...props
}: ToggleSwitchProps) {
  const sizeClass = size === "compact" ? "toggle-compact" : "toggle-standard";
  return (
    <label
      className={`toggle-switch ${sizeClass}${disabled ? " toggle-disabled" : ""}${className ? ` ${className}` : ""}`}
    >
      {offLabel && <span className="toggle-label toggle-label-off">{offLabel}</span>}
      <input
        type="checkbox"
        className="toggle-input"
        checked={checked}
        disabled={disabled}
        {...props}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      {onLabel && <span className="toggle-label toggle-label-on">{onLabel}</span>}
    </label>
  );
}
