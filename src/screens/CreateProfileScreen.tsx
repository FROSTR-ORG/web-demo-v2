import type { FormEvent } from "react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { defaultCreateProfileDraft, useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField, SectionHeader, Stepper, TextField } from "../components/ui";
import {
  PeerPermissionTagGroup,
  type PeerPermissionMethod,
} from "../components/PeerPermissionTags";
import { useDemoUi } from "../demo/demoUi";
import { shortHex } from "../lib/bifrost/format";

export function CreateProfileScreen() {
  const navigate = useNavigate();
  const { createSession, createProfile } = useAppState();
  const demoUi = useDemoUi();
  const presetPassword = demoUi.shared?.passwordPreset ?? "";
  // fix-followup-distribute-2a — distributionPassword /
  // confirmDistributionPassword are no longer part of CreateProfileDraft.
  // Distribution passwords are now collected per-share on the
  // DistributeSharesScreen via encodeDistributionPackage.
  const [draft, setDraft] = useState(() => ({
    ...defaultCreateProfileDraft(),
    deviceName: demoUi.shared?.profileNamePreset ?? defaultCreateProfileDraft().deviceName,
    password: presetPassword,
    confirmPassword: presetPassword,
    relays: demoUi.shared?.relayPreset ? ["wss://relay.primal.net", demoUi.shared.relayPreset] : defaultCreateProfileDraft().relays
  }));
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

  function getPeerPermission(idx: number, key: PeerPermissionMethod): boolean {
    return draft.peerPermissions?.[idx]?.[key] ?? true;
  }

  function setPeerPermission(idx: number, key: PeerPermissionMethod, value: boolean) {
    setDraft((current) => ({
      ...current,
      peerPermissions: {
        ...current.peerPermissions,
        [idx]: {
          sign: getPeerPermission(idx, "sign"),
          ecdh: getPeerPermission(idx, "ecdh"),
          ping: getPeerPermission(idx, "ping"),
          onboard: getPeerPermission(idx, "onboard"),
          [key]: value,
        },
      },
    }));
  }

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <form className="screen-column" onSubmit={submit}>
        <Stepper current={2} variant="shared" />
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

        {/* fix-followup-distribute-2b — the former shared remote-package
            password input was removed in 2A; the paper-parity rewrite (Paper
            60R-0) renders only Profile Name, Assigned Local Share info,
            Profile Password + Confirm, Relays, and Peer Permissions before the
            Continue CTA. Per-share distribution passwords are now collected on
            the DistributeSharesScreen via encodeDistributionPackage. */}

        <div className="password-group">
          <SectionHeader title="Profile Password" copy="This password encrypts your profile on this device. You'll need it each time you unlock it." infoIcon />
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
          {members.map((member) => (
            <div className="permission-row" key={member.pubkey}>
              <div className="permission-main">
                <span className="value">Peer #{member.idx}</span>
                {member.idx === localShare.idx ? null : <span className="help">{shortHex(member.pubkey, 8, 4)}</span>}
              </div>
              <div className="inline-actions permission-toggles">
                {member.idx === localShare.idx ? (
                  <PeerPermissionTagGroup />
                ) : (
                  <PeerPermissionTagGroup
                    interactive
                    values={{
                      sign: getPeerPermission(member.idx, "sign"),
                      ecdh: getPeerPermission(member.idx, "ecdh"),
                      ping: getPeerPermission(member.idx, "ping"),
                      onboard: getPeerPermission(member.idx, "onboard"),
                    }}
                    onToggle={(method, nextValue) =>
                      setPeerPermission(member.idx, method, nextValue)
                    }
                    ariaLabel={(method, active) =>
                      `${active ? "Disable" : "Enable"} ${method} permission for Peer #${member.idx}`
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {error ? <div className="error">{error}</div> : null}
        <Button type="submit" size="full" disabled={busy || !confirmMatches}>
          {busy ? "Creating Profile..." : "Continue to Distribute Shares"}
        </Button>
      </form>
    </AppShell>
  );
}
