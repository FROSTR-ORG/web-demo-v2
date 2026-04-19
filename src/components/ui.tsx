import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft, Copy, Eye, EyeOff, Minus, Plus, QrCode } from "lucide-react";
import { useEffect, useId, useState } from "react";
import QRCode from "qrcode";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "chip" | "header";
type ButtonSize = "sm" | "md" | "full" | "icon";

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const nextClassName = ["button", `button-${variant}`, `button-${size}`, className].filter(Boolean).join(" ");
  return (
    <button {...props} className={nextClassName}>
      {children}
    </button>
  );
}

export function BackLink({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="back-link" onClick={onClick}>
      <ChevronLeft size={14} />
      {label}
    </button>
  );
}

export function SectionHeader({ title, copy }: { title: string; copy?: string }) {
  return (
    <div className="section-block">
      <div className="section-title-row">
        <div className="section-title">{title}</div>
        <div className="section-rule" />
      </div>
      {copy ? <p className="section-copy">{copy}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  help,
  error,
  trailing,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string; trailing?: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="input-shell">
        <input {...props} className={`input${error ? " input-error" : ""}`} />
        {trailing ? <span className="input-trailing">{trailing}</span> : null}
      </span>
      {help && !error ? <span className="help">{help}</span> : null}
      {error ? <span className="field-error-text">{error}</span> : null}
    </label>
  );
}

export function PasswordField({
  label,
  help,
  error,
  checked,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string; checked?: boolean }) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <span className={`password-shell ${checked ? "checked" : ""}`}>
        <input {...props} id={id} className="input password-input" type={visible ? "text" : "password"} />
        {checked ? (
          <span className="password-check" aria-hidden="true">
            <Check size={14} />
          </span>
        ) : (
          <button
            type="button"
            className="password-toggle"
            aria-label={visible ? "Hide password" : "Show password"}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </span>
      {help ? <span className="help">{help}</span> : null}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

export function NumberStepper({
  value,
  min,
  max,
  onChange,
  label
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="number-stepper">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Minus size={14} />
        </button>
        <div className="number-value">{value}</div>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

export function Stepper({ current, variant = "create" }: { current: 1 | 2 | 3; variant?: "create" | "shared" }) {
  const steps = [
    { n: 1, label: variant === "create" ? "Create" : "Create / Rotate" },
    { n: 2, label: "Create Profile" },
    { n: 3, label: "Distribute Shares" }
  ] as const;
  return (
    <div className={`stepper stepper-${variant}`} aria-label="Create progress">
      {steps.map((step, index) => (
        <FragmentStep key={step.n} step={step} current={current} lineDone={step.n < current} last={index === steps.length - 1} />
      ))}
    </div>
  );
}

function FragmentStep({
  step,
  current,
  lineDone,
  last
}: {
  step: { n: 1 | 2 | 3; label: string };
  current: 1 | 2 | 3;
  lineDone: boolean;
  last: boolean;
}) {
  const state = step.n < current ? "done" : step.n === current ? "active" : "";
  return (
    <>
      <div className={`step ${state}`}>
        <div className="step-dot">{step.n < current ? <Check size={16} /> : step.n}</div>
        <div>{step.label}</div>
      </div>
      {last ? null : <div className={`step-line ${lineDone ? "done" : ""}`} />}
    </>
  );
}

export function StatusPill({
  children,
  tone = "default",
  marker = "none",
  className
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "error" | "info";
  marker?: "none" | "dot" | "check";
  className?: string;
}) {
  return (
    <span className={["status-pill", tone === "default" ? "" : tone, className].filter(Boolean).join(" ")}>
      {marker === "dot" ? <span className="dot" /> : null}
      {marker === "check" ? <Check size={12} /> : null}
      {children}
    </span>
  );
}

export function PermissionBadge({ children, tone = "success", muted = false }: { children: ReactNode; tone?: "success" | "info" | "ping" | "onboard"; muted?: boolean }) {
  return <span className={`permission-badge ${tone} ${muted ? "muted" : ""}`}>{children}</span>;
}

export function SecretDisplay({
  value,
  masked = false,
  placeholder,
  dashed = false,
  title
}: {
  value?: string;
  masked?: boolean;
  placeholder?: string;
  dashed?: boolean;
  title?: string;
}) {
  const displayValue = placeholder ?? (masked ? maskSecret(value ?? "") : value);
  return (
    <div className={`secret-display ${dashed ? "dashed" : ""}`} title={title ?? value}>
      <span>{displayValue}</span>
    </div>
  );
}

export function CopyBlock({ value, label = "Copy", onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <SecretDisplay value={value} masked />
      <Button
        type="button"
        variant="chip"
        size="sm"
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          onCopied?.();
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        <Copy size={13} />
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}

export function QrButton({ value, onShown, disabled }: { value: string; onShown?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="chip"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          onShown?.();
        }}
      >
        <QrCode size={13} />
        QR
      </Button>
      {open ? <QrModal value={value} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QrModal({ value, onClose }: { value: string; onClose: () => void }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { margin: 1, width: 280 }).then((nextUrl) => {
      if (active) {
        setUrl(nextUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [value]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2 className="modal-title">Package QR</h2>
        {url ? <img className="qr-img" src={url} alt="QR code for package" /> : <p className="page-copy">Generating QR...</p>}
        <div className="form-actions">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

function maskSecret(value: string) {
  if (value.startsWith("bfonboard")) {
    return `${value.slice(0, 10)}${"•".repeat(34)}`;
  }
  return "•".repeat(Math.min(Math.max(value.length, 8), 16));
}
