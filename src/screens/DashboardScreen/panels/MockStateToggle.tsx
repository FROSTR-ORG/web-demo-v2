import type { DashboardState, ModalState } from "../types";

export function MockStateToggle({
  mockState,
  onChangeMockState,
  onOpenModal,
}: {
  mockState: DashboardState;
  onChangeMockState: (state: DashboardState) => void;
  onOpenModal: (modal: Exclude<ModalState, "none">) => void;
}) {
  return (
    <div className="dash-state-toggle">
      <label className="dash-state-toggle-label" htmlFor="mock-state-select">
        Mock State
      </label>
      <select
        id="mock-state-select"
        className="dash-state-toggle-select"
        value={mockState}
        onChange={(e) => onChangeMockState(e.target.value as DashboardState)}
        aria-label="Mock State"
      >
        <option value="running">Running</option>
        <option value="connecting">Connecting</option>
        <option value="stopped">Stopped</option>
        <option value="relays-offline">All Relays Offline</option>
        <option value="signing-blocked">Signing Blocked</option>
      </select>
      <div className="dash-modal-triggers">
        <span className="dash-modal-trigger-label">Modals:</span>
        <button
          type="button"
          className="dash-modal-trigger-btn"
          onClick={() => onOpenModal("policy-prompt")}
          aria-label="Open Policy Prompt"
        >
          Policy Prompt
        </button>
        <button
          type="button"
          className="dash-modal-trigger-btn"
          onClick={() => onOpenModal("signing-failed")}
          aria-label="Open Signing Failed"
        >
          Signing Failed
        </button>
      </div>
    </div>
  );
}
