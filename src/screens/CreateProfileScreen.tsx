import type { FormEvent } from "react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { defaultCreateProfileDraft, useAppState } from "../app/AppState";
import { AppShell } from "../components/shell";
import {
  PEER_PERMISSION_METHODS,
  type PeerPermissionMethod,
} from "../components/PeerPermissionTags";
import { useDemoUi } from "../demo/demoUi";
import { ProfileSetupForm } from "./ProfileSetupForm";

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

  function setPeerPermission(idx: number, key: PeerPermissionMethod, value: boolean) {
    setDraft((current) => {
      const currentRow = current.peerPermissions?.[idx];
      const rowWithDefaults = Object.fromEntries(
        PEER_PERMISSION_METHODS.map((method) => [
          method,
          currentRow?.[method] ?? true,
        ]),
      ) as Record<PeerPermissionMethod, boolean>;
      return {
        ...current,
        peerPermissions: {
          ...current.peerPermissions,
          [idx]: {
            ...rowWithDefaults,
            [key]: value,
          },
        },
      };
    });
  }

  return (
    <AppShell headerMeta={createSession.draft.groupName} mainVariant="flow">
      <ProfileSetupForm
        stepperVariant="shared"
        profileName={draft.deviceName}
        password={draft.password}
        confirmPassword={draft.confirmPassword}
        relays={draft.relays}
        relayInput={relayInput}
        localShareIdx={localShare.idx}
        keysetName={createSession.keyset.group.group_name}
        members={members}
        busy={busy}
        error={error}
        onSubmit={submit}
        onBack={() => navigate("/create")}
        onProfileNameChange={(deviceName) => setDraft((current) => ({ ...current, deviceName }))}
        onPasswordChange={(password) => setDraft((current) => ({ ...current, password }))}
        onConfirmPasswordChange={(confirmPassword) => setDraft((current) => ({ ...current, confirmPassword }))}
        onRelayInputChange={setRelayInput}
        onRelayAdd={() => {
          const relay = relayInput.trim();
          if (relay && !draft.relays.includes(relay)) {
            setDraft((current) => ({ ...current, relays: [...current.relays, relay] }));
            setRelayInput("wss://");
          }
        }}
        onRelayRemove={(relay) => setDraft((current) => ({ ...current, relays: current.relays.filter((entry) => entry !== relay) }))}
        peerPermissionValues={(idx) => draft.peerPermissions?.[idx]}
        onPeerPermissionToggle={setPeerPermission}
      />
    </AppShell>
  );
}
