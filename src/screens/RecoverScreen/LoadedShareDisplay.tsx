import { Lock } from "lucide-react";
import type { ReactNode } from "react";

interface LoadedShareDisplayProps {
  children: ReactNode;
  active?: boolean;
}

export function LoadedShareDisplay({ children, active = true }: LoadedShareDisplayProps) {
  return (
    <div className="recover-share-display loaded">
      <span className={active ? "recover-share-hex-active" : "recover-share-hex"}>{children}</span>
      <Lock size={14} className="recover-share-icon" />
    </div>
  );
}
