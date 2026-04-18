import type { FormEvent } from "react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { defaultProfileDraft, useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField, PermissionBadge, SectionHeader, Stepper, TextField } from "../components/ui";
import { shortHex } from "../lib/bifrost/format";

export function CreateProfileScreen() {
  const navigate = useNavigate();
  const { createSession, createProfile } = useAppState();
  const [draft, setDraft] = useState(defaultProfileDraft);
  const [relayInput, setRelayInput] = useState("wss://");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!createSession?.keyset || !createSession.localShare) {
    return <Navigate to="/create" replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createProfile(draft);
      navigate("/create/distribute");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create profile.");
    } finally {
      setBusy(false);
    }
  }

  const localShare = createSession.localShare;
  const members = createSession.keyset.group.members;
  const confirmMatches = draft.password.length > 0 && draft.password === draft.confirmPassword;

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <form className="screen-column" onSubmit={submit}>
        <Stepper current={2} variant="create" />
        <BackLink onClick={() => navigate("/create")} />
        <PageHeading
          title="Create Profile"
          copy="Set the local profile name, password, relays, and peer permissions for the assigned share before distributing the remaining device packages."
        />
        <SectionHeader title="Profile Name" copy="A name for this profile to identify it in the peer list." />
        <TextField label="Profile Name" value={draft.deviceName} onChange={(event) => setDraft((current) => ({ ...current, deviceName: event.target.value }))} />

        <div className="assigned-share-card">
          <div className="assigned-share-head">
            <span className="check-disc">
              <Check size={15} />
            </span>
            <div>
              <div className="value">Assigned Local Share</div>
              <div className="help">The local share for this device is already assigned and ready for profile creation.</div>
            </div>
          </div>
          <div className="kv-row">
            <div>
              <div className="kicker">Local Share</div>
              <div className="value">Share #{localShare.idx}, Encrypted</div>
            </div>
            <div>
              <div className="kicker">Keyset</div>
              <div className="value">{createSession.keyset.group.group_name}</div>
            </div>
          </div>
        </div>

        <div className="password-group">
          <SectionHeader title="Profile Password" copy="This password encrypts your profile on this device. You'll need it each time you unlock it." />
          <div className="profile-password-row">
            <PasswordField label="Password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} />
            <PasswordField
              label="Confirm Password"
              value={draft.confirmPassword}
              checked={confirmMatches}
              onChange={(event) => setDraft((current) => ({ ...current, confirmPassword: event.target.value }))}
            />
          </div>
        </div>

        <SectionHeader title="Relays" />
        <div className="relay-list">
          {draft.relays.map((relay, index) => (
            <div className="relay-row" key={relay}>
              <div className="relay-details">
                <span className="value">{relay}</span>
                {index === 0 ? <span className="relay-status">Connected - 24ms latency</span> : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setDraft((current) => ({ ...current, relays: current.relays.filter((entry) => entry !== relay) }))}
                aria-label={`Remove ${relay}`}
              >
                <X size={14} />
              </Button>
            </div>
          ))}
          <div className="relay-row relay-add-row">
            <span className="input-shell">
              <input className="input" value={relayInput} onChange={(event) => setRelayInput(event.target.value)} />
            </span>
            <Button
              type="button"
              className="relay-add-button"
              onClick={() => {
                const relay = relayInput.trim();
                if (relay && !draft.relays.includes(relay)) {
                  setDraft((current) => ({ ...current, relays: [...current.relays, relay] }));
                  setRelayInput("wss://");
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <SectionHeader title="Peer Permissions" copy="Set default permissions for each peer. You can change these later in Settings." />
        <div className="permission-list">
          {members.map((member, index) => (
            <div className="permission-row" key={member.pubkey}>
              <div className="permission-main">
                <span className="value">Peer #{member.idx}</span>
                {member.idx === localShare.idx ? null : <span className="help">{shortHex(member.pubkey, 8, 4)}</span>}
              </div>
              <div className="inline-actions">
                <PermissionBadge>SIGN</PermissionBadge>
                <PermissionBadge tone="info" muted={index === 1}>
                  ECDH
                </PermissionBadge>
                <PermissionBadge tone="ping" muted={index === 2}>
                  PING
                </PermissionBadge>
                <PermissionBadge tone="onboard" muted={member.idx === localShare.idx || index === 2}>
                  ONBOARD
                </PermissionBadge>
              </div>
            </div>
          ))}
        </div>

        {error ? <div className="error">{error}</div> : null}
        <Button type="submit" size="full" disabled={busy}>
          {busy ? "Creating Profile..." : "Continue to Distribute Shares"}
        </Button>
      </form>
    </AppShell>
  );
}
