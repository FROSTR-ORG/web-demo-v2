export type DashboardState = "running" | "connecting" | "stopped" | "relays-offline" | "signing-blocked";
export type ModalState =
  | "none"
  | "policy-prompt"
  | "signing-failed"
  | "clear-credentials"
  | "export-profile"
  | "export-complete"
  /**
   * m6-backup-publish — "Publish Backup to Relay" password-prompt +
   * strength-meter + confirm-mismatch modal that drives
   * `AppStateValue.publishProfileBackup`. See
   * `src/screens/DashboardScreen/modals/PublishBackupModal.tsx`.
   */
  | "publish-backup";
export type ExportMode = "profile" | "share";
