import type { FormEvent } from "react";
import { ArrowDown, Info, KeyRound, Lock, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logoUrl from "../assets/igloo-logo.png";
import { useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import { Button, PasswordField, StatusPill } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";

export function WelcomeScreen() {
  const navigate = useNavigate();
  const { profiles, unlockProfile } = useAppState();
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const returning = profiles.length > 0;
  const isMulti = profiles.length >= 2;
  const isMany = profiles.length >= 4;

  /* --- Scrollable list overflow tracking for 4+ profiles --- */
  const listRef = useRef<HTMLDivElement>(null);
  const [hiddenBelow, setHiddenBelow] = useState(0);

  const updateHiddenCount = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    /* approximate: each card is ~112px (104px + 8px gap) */
    const estimate = Math.max(0, Math.round(remaining / 112));
    setHiddenBelow(estimate);
  }, []);

  useEffect(() => {
    if (!isMany) return;
    const el = listRef.current;
    if (!el) return;
    updateHiddenCount();
    el.addEventListener("scroll", updateHiddenCount);
    return () => el.removeEventListener("scroll", updateHiddenCount);
  }, [isMany, profiles.length, updateHiddenCount]);

  /* --- Unlock modal handler --- */
  const unlockingProfile = unlocking ? profiles.find((p) => p.id === unlocking) : null;

  async function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocking) {
      return;
    }
    setError("");
    try {
      await unlockProfile(unlocking, password);
      navigate(`/dashboard/${unlocking}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect password. Please try again.");
    }
  }

  function openUnlock(profileId: string) {
    setUnlocking(profileId);
    setPassword("");
    setError("");
  }

  /* --- Render helpers --- */

  /** Profile row for multi/many returning variants (2+ profiles): Unlock + Rotate buttons */
  function renderMultiProfileRow(profile: typeof profiles[number]) {
    return (
      <div key={profile.id} className="profile-card">
        <span className="icon-tile">
          <KeyRound size={17} />
        </span>
        <span className="profile-row-main" style={{ flex: "1 1 0" }}>
          <span>
            <span className="value">{profile.label}</span>
            <span className="help">
              {profile.threshold}/{profile.memberCount} · #{profile.localShareIdx} · {shortHex(profile.groupPublicKey, 10, 8)}
            </span>
          </span>
        </span>
        <span className="profile-row-actions">
          <button
            type="button"
            className="profile-row-btn unlock"
            onClick={() => openUnlock(profile.id)}
          >
            Unlock
          </button>
          <button
            type="button"
            className="profile-row-btn rotate"
            onClick={() => navigate("/rotate-keyset")}
          >
            Rotate
          </button>
        </span>
      </div>
    );
  }

  /** Secondary chip-style actions for multi/many returning variants */
  function renderReturningChipActions() {
    return (
      <div className="returning-chip-actions">
        <span>or</span>
        <button type="button" className="returning-chip-btn" onClick={() => navigate("/create")}>
          New Keyset
        </button>
        <button type="button" className="returning-chip-btn" onClick={() => navigate("/import")}>
          Import Device Profile
        </button>
        <button type="button" className="returning-chip-btn" disabled>
          Onboard
        </button>
      </div>
    );
  }

  return (
    <AppShell>
      <section className="hero">
        <div className="hero-lockup">
          <img className="hero-logo" src={logoUrl} alt="" />
          <div>
            <h1 className="hero-title">Igloo Web</h1>
            <p className="hero-subtitle">{returning ? "Welcome back." : "Split your Nostr key. Sign from anywhere."}</p>
          </div>
        </div>

        {/* ---- First-time welcome (no profiles) ---- */}
        {!returning && (
          <div className="panel welcome-card">
            <div className="welcome-card-body">
              <div className="welcome-card-title">
                <span className="icon-tile">
                  <Plus size={18} />
                </span>
                <span className="welcome-card-title-main">
                  New Keyset
                  <Info size={14} />
                </span>
              </div>
              <p className="welcome-card-copy">Generate a new threshold keyset and set up its first device profile.</p>
            </div>
            <div className="welcome-actions">
              <Button type="button" size="full" onClick={() => navigate("/create")}>
                New Keyset
              </Button>
            </div>
            <div className="secondary-actions">
              <span>or</span>
              <Button type="button" variant="secondary" size="sm" onClick={() => navigate("/import")}>
                Import Device Profile
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled>
                Onboard
              </Button>
            </div>
          </div>
        )}

        {/* ---- Single returning profile ---- */}
        {returning && !isMulti && (
          <div className="profile-list">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className="profile-row"
                type="button"
                onClick={() => openUnlock(profile.id)}
              >
                <span className="profile-row-main">
                  <span className="icon-tile">
                    <KeyRound size={17} />
                  </span>
                  <span>
                    <span className="value">{profile.label}</span>
                    <span className="help">
                      {profile.threshold}/{profile.memberCount} · {shortHex(profile.groupPublicKey, 10, 8)}
                    </span>
                  </span>
                </span>
                <StatusPill>Unlock</StatusPill>
              </button>
            ))}
            <div className="profile-row">
              <Button type="button" onClick={() => navigate("/create")}>
                <Plus size={16} />
                New Keyset
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate("/import")}>
                <Upload size={16} />
                Import Device Profile
              </Button>
            </div>
          </div>
        )}

        {/* ---- Multi returning (2-3 profiles) ---- */}
        {isMulti && !isMany && (
          <>
            <div style={{ width: "min(100%, 560px)", display: "flex", flexDirection: "column", gap: "8px" }}>
              {profiles.map(renderMultiProfileRow)}
            </div>
            {renderReturningChipActions()}
          </>
        )}

        {/* ---- Many returning (4+ profiles) ---- */}
        {isMany && (
          <>
            <div
              ref={listRef}
              className="profile-list-scrollable"
            >
              {profiles.map(renderMultiProfileRow)}
            </div>
            {hiddenBelow > 0 && (
              <div className="profile-scroll-indicator">
                <ArrowDown size={12} />
                <span>{hiddenBelow} more below</span>
                <ArrowDown size={12} />
              </div>
            )}
            {renderReturningChipActions()}
            <div className="profile-count">
              <span className="profile-count-number">{profiles.length}</span>
              <span className="profile-count-label">saved profiles</span>
            </div>
          </>
        )}
      </section>

      {/* ---- Unlock modal ---- */}
      {unlocking ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="modal" onSubmit={submitUnlock}>
            <div className="unlock-modal-header">
              <span className="unlock-modal-icon">
                <Lock size={20} />
              </span>
              <div className="unlock-modal-info">
                <h2 className="unlock-modal-title">Unlock Profile</h2>
                {unlockingProfile && (
                  <span className="unlock-modal-subtitle">
                    {unlockingProfile.label} · {unlockingProfile.threshold}/{unlockingProfile.memberCount} · #{unlockingProfile.localShareIdx}
                  </span>
                )}
              </div>
            </div>
            <p className="page-copy" style={{ marginBottom: "18px" }}>
              Enter your profile password to decrypt and load the signing share.
            </p>
            <PasswordField
              label="Profile Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={error}
              autoFocus
            />
            <div className="form-actions" style={{ marginTop: "18px" }}>
              <Button type="submit">Unlock</Button>
              <Button type="button" variant="ghost" onClick={() => setUnlocking(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
