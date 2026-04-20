import { Check } from "lucide-react";

export function LoadedBadge() {
  return (
    <span className="recover-loaded-badge">
      <Check size={12} strokeWidth={2.5} />
      Loaded
    </span>
  );
}
