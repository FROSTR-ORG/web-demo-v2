import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell } from "../../components/shell";
import { useDemoUi } from "../../demo/demoUi";
import { ProfileSetupForm } from "../ProfileSetupForm";
import { MOCK_ROTATE_MEMBERS, MOCK_SOURCE_SHARE_1 } from "./mocks";
import { navigateWithRotateState, rotatePhaseAtLeast } from "./utils";

export function RotateCreateProfileScreen() {
  const navigate = useNavigate();
  const { rotateKeysetSession, createRotatedProfile } = useAppState();
  const demoUi = useDemoUi();
  const demoProfile = Boolean(demoUi.rotateKeyset || demoUi.progress);
  const presetPassword = rotateKeysetSession
    ? ""
    : demoUi.rotateKeyset?.passwordPreset ?? "";
  const rotatedGroup = rotateKeysetSession?.rotated?.next.group;
  const previousLocalIdx = rotateKeysetSession?.sourceShares[0]?.idx;
  const rotatedLocalShare =
    rotateKeysetSession?.rotated?.next.shares.find(
      (share) => share.idx === previousLocalIdx,
    ) ?? rotateKeysetSession?.rotated?.next.shares[0];
  const [deviceName, setDeviceName] = useState(
    rotateKeysetSession?.sourcePayload?.device.name ?? "Igloo Web",
  );
  const [password, setPassword] = useState(presetPassword);
  const [confirmPassword, setConfirmPassword] = useState(presetPassword);
  const [relays, setRelays] = useState(
    rotateKeysetSession?.sourcePayload?.device.relays ?? [
      "wss://relay.primal.net",
      "wss://relay.example.com",
    ],
  );
  const [relayInput, setRelayInput] = useState("wss://");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const confirmMatches = password.length > 0 && password === confirmPassword;
  const members =
    rotatedGroup?.members ??
    MOCK_ROTATE_MEMBERS.map((member) => ({
      idx: member.idx,
      pubkey: "02a3f8c2d1e4b7f9a0c3d2e1b6f8a7c4d2e1b9f3a4c5d6e7f8a9b0c1d28f2c",
    }));
  const blocked =
    !rotatePhaseAtLeast(rotateKeysetSession, "rotated") && !demoProfile;
  const routeState = rotateKeysetSession
    ? { profileId: rotateKeysetSession.sourceProfile.id }
    : undefined;

  if (blocked) {
    return <Navigate to="/rotate-keyset/review" replace state={routeState} />;
  }

  async function handleContinue() {
    if (!rotateKeysetSession) {
      navigateWithRotateState(
        navigate,
        "/rotate-keyset/distribute",
        routeState,
      );
      return;
    }
    if (!createRotatedProfile) {
      setError("Rotated profile creation is unavailable in this session.");
      return;
    }
    if (!confirmMatches) {
      setError("Profile passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createRotatedProfile({
        deviceName,
        password,
        confirmPassword,
        relays,
      });
      navigateWithRotateState(
        navigate,
        "/rotate-keyset/distribute",
        routeState,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create rotated profile.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      headerMeta={
        rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label
      }
      mainVariant="flow"
    >
      <ProfileSetupForm
        stepperVariant="rotate-keyset"
        profileName={deviceName}
        password={password}
        confirmPassword={confirmPassword}
        relays={relays}
        relayInput={relayInput}
        localShareIdx={rotatedLocalShare?.idx ?? 0}
        keysetName={rotatedGroup?.group_name ?? MOCK_SOURCE_SHARE_1.label}
        members={members}
        busy={busy}
        error={error}
        submitType="button"
        continueDisabled={Boolean(rotateKeysetSession) && !confirmMatches}
        onContinue={() => void handleContinue()}
        onBack={() =>
          navigateWithRotateState(
            navigate,
            "/rotate-keyset/progress",
            routeState,
          )
        }
        onProfileNameChange={setDeviceName}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onRelayInputChange={setRelayInput}
        onRelayAdd={() => {
          const relay = relayInput.trim();
          if (relay && !relays.includes(relay)) {
            setRelays((cur) => [...cur, relay]);
            setRelayInput("wss://");
          }
        }}
        onRelayRemove={(relay) => setRelays((cur) => cur.filter((entry) => entry !== relay))}
      />
    </AppShell>
  );
}
