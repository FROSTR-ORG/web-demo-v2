import type { ReactNode } from "react";

interface RecoveredNsecBlockProps {
  children: ReactNode;
  label: string;
  valueClassName: string;
}

export function RecoveredNsecBlock({ children, label, valueClassName }: RecoveredNsecBlockProps) {
  return (
    <div className="recover-nsec-block">
      <span className="recover-nsec-label">{label}</span>
      <div className="recover-nsec-display">
        <span className={valueClassName}>{children}</span>
      </div>
    </div>
  );
}
