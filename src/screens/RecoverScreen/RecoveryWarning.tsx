import { AlertTriangle } from "lucide-react";

interface RecoveryWarningProps {
  secondsRemaining: number;
}

export function RecoveryWarning({ secondsRemaining }: RecoveryWarningProps) {
  return (
    <div className="recover-warning-panel">
      <AlertTriangle size={20} className="recover-warning-icon" />
      <div className="recover-warning-content">
        <div className="recover-warning-title">Security Warning</div>
        <ul className="recover-warning-list">
          <li>Your private key will auto-clear in {secondsRemaining} seconds</li>
          <li>Do not screenshot or share this key</li>
          <li>Copy to a secure password manager</li>
        </ul>
      </div>
    </div>
  );
}
