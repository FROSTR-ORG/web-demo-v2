import type { FormEvent } from "react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { defaultCreateProfileDraft, useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Button, PasswordField, SectionHeader, Stepper, TextField } from "../components/ui";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useDemoUi } from "../demo/demoUi";
import { shortHex } from "../lib/bifrost/format";

export function CreateProfileScreen() {
  const navigate = useNavigate();
  const { createSession, createProfile } = useAppState();
  const demoUi = useDemoUi();
  const presetPassword = demoUi.shared?.passwordPreset ?? "";
  const [draft, setDraft] = useState(() => ({
    ...defaultCreateProfileDraft(),
    deviceName: demoUi.shared?.profileNamePreset ?? defaultCreateProfileDraft().deviceName,
    password: presetPassword,
    confirmPassword: presetPassword,
    distributionPassword: presetPassword,
    confirmDistributionPassword: presetPassword,
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
  const distributionPasswordMatches =
    draft.distributionPassword.length > 0 && draft.distributionPassword === draft.confirmDistributionPassword;

  function getPeerPermission(idx: number, key: "sign" | "ecdh" | "ping" | "onboard"): boolean {
    return draft.peerPermissions?.[idx]?.[key] ?? true;
  }

  function setPeerPermission(idx: number, key: "sign" | "ecdh" | "ping" | "onboard", value: boolean) {
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

        <div className="password-group">
          <SectionHeader
            title="Remote Package Password"
            copy="This password decrypts every remote bfonboard package you distribute from this setup."
            infoIcon
          />
          <div className="profile-password-row">
            <PasswordField
              label="Remote Package Password"
              value={draft.distributionPassword}
              onChange={(event) => setDraft((current) => ({ ...current, distributionPassword: event.target.value }))}
            />
            <PasswordField
              label="Confirm Remote Package Password"
              value={draft.confirmDistributionPassword}
              checked={distributionPasswordMatches}
              onChange={(event) => setDraft((current) => ({ ...current, confirmDistributionPassword: event.target.value }))}
            />
          </div>
        </div>

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
                  <span className="help">Local profile</span>
                ) : (
                  <>
                    <ToggleSwitch
                      size="compact"
                      checked={getPeerPermission(member.idx, "sign")}
                      onChange={(e) => setPeerPermission(member.idx, "sign", e.target.checked)}
                      onLabel="SIGN"
                    />
                    <ToggleSwitch
                      size="compact"
                      checked={getPeerPermission(member.idx, "ecdh")}
                      onChange={(e) => setPeerPermission(member.idx, "ecdh", e.target.checked)}
                      onLabel="ECDH"
                    />
                    <ToggleSwitch
                      size="compact"
                      checked={getPeerPermission(member.idx, "ping")}
                      onChange={(e) => setPeerPermission(member.idx, "ping", e.target.checked)}
                      onLabel="PING"
                    />
                    <ToggleSwitch
                      size="compact"
                      checked={getPeerPermission(member.idx, "onboard")}
                      onChange={(e) => setPeerPermission(member.idx, "onboard", e.target.checked)}
                      onLabel="ONBOARD"
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {error ? <div className="error">{error}</div> : null}
        <Button type="submit" size="full" disabled={busy || !confirmMatches || !distributionPasswordMatches}>
          {busy ? "Creating Profile..." : "Continue to Distribute Shares"}
        </Button>
      </form>
    </AppShell>
  );
}
