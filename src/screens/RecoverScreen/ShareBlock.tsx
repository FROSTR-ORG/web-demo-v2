import type { ReactNode } from "react";
import { LoadedBadge } from "./LoadedBadge";

interface ShareBlockProps {
  children: ReactNode;
  label: string;
  loaded?: boolean;
  mono?: boolean;
}

export function ShareBlock({ children, label, loaded = false, mono = false }: ShareBlockProps) {
  return (
    <div className="recover-share-block">
      <div className="recover-share-header">
        <span className={mono ? "recover-share-label-mono" : "recover-share-label"}>{label}</span>
        {loaded ? <LoadedBadge /> : null}
      </div>
      {children}
    </div>
  );
}
