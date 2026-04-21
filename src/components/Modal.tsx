import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: string;
  variant?: "default" | "danger" | "warning";
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, variant = "default", children, actions, className }: ModalProps) {
  if (!open) return null;

  const variantClass = variant === "danger" ? "modal-danger" : variant === "warning" ? "modal-warning" : "";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        if (event.target === event.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div className={`modal ${variantClass} ${className ?? ""}`} onClick={(event) => event.stopPropagation()}>
        {title ? (
          <div className="modal-header">
            <h2 className="modal-title">{title}</h2>
            {onClose ? (
              <button type="button" className="modal-close" aria-label="Close modal" onClick={onClose}>
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="modal-actions">{children}</div>;
}
