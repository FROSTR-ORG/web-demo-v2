import type { ButtonHTMLAttributes, ReactNode } from "react";

export const PEER_PERMISSION_METHODS = [
  "sign",
  "ecdh",
  "ping",
  "onboard",
] as const;

export type PeerPermissionMethod = (typeof PEER_PERMISSION_METHODS)[number];
export type PeerPermissionTone = "success" | "info" | "ping" | "onboard";

export const PEER_PERMISSION_META: Record<
  PeerPermissionMethod,
  { label: string; tone: PeerPermissionTone }
> = {
  sign: { label: "SIGN", tone: "success" },
  ecdh: { label: "ECDH", tone: "info" },
  ping: { label: "PING", tone: "ping" },
  onboard: { label: "ONBOARD", tone: "onboard" },
};

export type PeerPermissionValues = Partial<
  Record<PeerPermissionMethod, boolean>
>;

interface PeerPermissionTagBaseProps {
  method?: PeerPermissionMethod;
  tone?: PeerPermissionTone;
  active?: boolean;
  interactive?: boolean;
  pressed?: boolean;
  className?: string;
  children?: ReactNode;
}

export function PeerPermissionTag({
  method,
  tone,
  active = true,
  interactive = false,
  pressed,
  className,
  children,
  type = "button",
  ...buttonProps
}: PeerPermissionTagBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  const meta = method ? PEER_PERMISSION_META[method] : null;
  const resolvedTone = tone ?? meta?.tone ?? "success";
  const label = children ?? meta?.label;
  const classes = [
    "permission-badge",
    "peer-permission-tag",
    resolvedTone,
    active ? "" : "muted",
    interactive ? "peer-permission-tag-button" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (interactive) {
    return (
      <button
        {...buttonProps}
        type={type}
        className={classes}
        aria-pressed={pressed ?? active}
      >
        {label}
      </button>
    );
  }

  return <span className={classes}>{label}</span>;
}

export function PeerPermissionTagGroup({
  values,
  interactive = false,
  className,
  onToggle,
  ariaLabel,
}: {
  values?: PeerPermissionValues;
  interactive?: boolean;
  className?: string;
  onToggle?: (method: PeerPermissionMethod, nextValue: boolean) => void;
  ariaLabel?: (method: PeerPermissionMethod, active: boolean) => string;
}) {
  return (
    <span className={["peer-permission-tag-group", className].filter(Boolean).join(" ")}>
      {PEER_PERMISSION_METHODS.map((method) => {
        const active = values?.[method] ?? true;
        return (
          <PeerPermissionTag
            key={method}
            method={method}
            active={active}
            interactive={interactive}
            aria-label={ariaLabel?.(method, active)}
            onClick={
              interactive && onToggle
                ? () => {
                    onToggle(method, !active);
                  }
                : undefined
            }
          />
        );
      })}
    </span>
  );
}
