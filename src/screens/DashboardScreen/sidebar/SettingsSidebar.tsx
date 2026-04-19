import { X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { paperGroupKey } from "../mocks";

interface SettingsSidebarProps {
  profile: { groupName: string; deviceName: string };
  relays: string[];
  groupPublicKey: string;
  threshold: number;
  memberCount: number;
  shareIdx: number;
  onClose: () => void;
  onLock: () => void;
  onClearCredentials: () => void;
  onExport: () => void;
}

export function SettingsSidebar({
  profile,
  relays: initialRelays,
  groupPublicKey,
  threshold,
  memberCount,
  shareIdx,
  onClose,
  onLock,
  onClearCredentials,
  onExport,
}: SettingsSidebarProps) {
  const navigate = useNavigate();
  const [relays, setRelays] = useState(initialRelays);
  const [newRelay, setNewRelay] = useState("");

  function handleRemoveRelay(index: number) {
    setRelays((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAddRelay() {
    const trimmed = newRelay.trim();
    if (trimmed && !relays.includes(trimmed)) {
      setRelays((prev) => [...prev, trimmed]);
      setNewRelay("");
    }
  }

  return (
    <>
      {/* Scrim */}
      <div className="settings-scrim" onClick={onClose} data-testid="settings-scrim" />

      {/* Sidebar panel */}
      <div className="settings-sidebar" role="dialog" aria-label="Settings" data-testid="settings-sidebar">
        <div className="settings-sidebar-scroll">
          {/* Header */}
          <div className="settings-header">
            <div className="settings-title">Settings</div>
            <button
              type="button"
              className="settings-close"
              onClick={onClose}
              aria-label="Close settings"
            >
              <X size={16} />
            </button>
          </div>

          {/* DEVICE PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Device Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Profile Name</span>
                <div className="settings-row-value">
                  <span>{profile.deviceName}</span>
                  <span className="settings-edit-icon">✎</span>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Profile Password</span>
                <div className="settings-row-value">
                  <span>••••••••</span>
                  <button type="button" className="settings-change-btn">Change</button>
                </div>
              </div>
              {/* Relays */}
              <div className="settings-relays">
                {relays.map((relay, idx) => (
                  <div className="settings-relay-row" key={relay}>
                    <div className="settings-relay-url">{relay}</div>
                    <button
                      type="button"
                      className="settings-relay-remove"
                      aria-label={`Remove ${relay}`}
                      onClick={() => handleRemoveRelay(idx)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="settings-relay-row">
                  <input
                    className="settings-relay-input"
                    type="text"
                    placeholder="wss://..."
                    value={newRelay}
                    onChange={(e) => setNewRelay(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddRelay();
                    }}
                  />
                  <button
                    type="button"
                    className="settings-relay-add"
                    onClick={handleAddRelay}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="settings-hint">
              Configuration for this device's share (Share #{shareIdx})
            </div>
          </div>

          {/* GROUP PROFILE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Group Profile</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-card">
              <div className="settings-row">
                <span className="settings-row-label">Keyset Name</span>
                <span className="settings-row-text">{profile.groupName}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Keyset npub</span>
                <span className="settings-row-npub">{paperGroupKey(groupPublicKey)}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Threshold</span>
                <span className="settings-row-text">{threshold} of {memberCount}</span>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Created</span>
                <span className="settings-row-text">Feb 24, 2026</span>
              </div>
              <div className="settings-row settings-row-last">
                <span className="settings-row-label">Updated</span>
                <span className="settings-row-text">Mar 8, 2026</span>
              </div>
            </div>
            <div className="settings-hint">
              Shared across all peers. Synced via Nostr.
            </div>
          </div>

          {/* ROTATE SHARE */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Rotate Share</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-row">
              <div className="settings-action-info">
                <div className="settings-action-name">Rotate Share</div>
                <div className="settings-action-desc">
                  Replace only this device's local share from Settings while keeping the same group public key and keyset membership.
                </div>
              </div>
              <button type="button" className="settings-btn-blue" onClick={() => { onClose(); navigate('/rotate-share'); }}>Rotate Share</button>
            </div>
          </div>

          {/* EXPORT & BACKUP */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Export &amp; Backup</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Profile</div>
                  <div className="settings-action-desc">
                    Encrypted backup of your share and configuration
                  </div>
                </div>
                <button type="button" className="settings-btn-blue" onClick={onExport}>Export</button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Export Share</div>
                  <div className="settings-action-desc">
                    Unencrypted share key in hex
                  </div>
                </div>
                <button type="button" className="settings-btn-muted">Copy</button>
              </div>
            </div>
          </div>

          {/* PROFILE SECURITY */}
          <div className="settings-section">
            <div className="settings-section-header">
              <span className="settings-section-label">Profile Security</span>
              <span className="settings-section-rule" />
            </div>
            <div className="settings-action-group">
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Lock Profile</div>
                  <div className="settings-action-desc">
                    Return to profile list to open another profile
                  </div>
                </div>
                <button type="button" className="settings-btn-red" onClick={onLock}>
                  Lock
                </button>
              </div>
              <div className="settings-action-row">
                <div className="settings-action-info">
                  <div className="settings-action-name">Clear Credentials</div>
                  <div className="settings-action-desc">
                    Delete this device's saved profile, share, password, and relay configuration
                  </div>
                </div>
                <button type="button" className="settings-btn-red" onClick={onClearCredentials}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
