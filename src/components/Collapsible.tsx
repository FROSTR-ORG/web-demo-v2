import type { ReactNode } from "react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface CollapsibleProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function Collapsible({ title, children, defaultOpen = false, className }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`collapsible ${className ?? ""}`}>
      <button
        type="button"
        className="collapsible-header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <ChevronDown
          size={14}
          className={`collapsible-chevron${open ? " collapsible-chevron-open" : ""}`}
          aria-hidden="true"
        />
        <span className="collapsible-title">{title}</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}
