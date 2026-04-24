import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, X } from "lucide-react";
import { useAppState } from "../../app/AppState";
import { PeerPermissionTagGroup } from "../../components/PeerPermissionTags";
import { AppShell, PageHeading } from "../../components/shell";
import {
  BackLink,
  Button,
  PasswordField,
  SectionHeader,
  Stepper,
  TextField,
} from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
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
      <div className="screen-column">
        <Stepper current={2} variant="rotate-keyset" />
        <BackLink
          onClick={() =>
            navigateWithRotateState(
              navigate,
              "/rotate-keyset/progress",
              routeState,
            )
          }
        />
        <PageHeading
          title="Create Profile"
          copy="Set the local profile name, password, relays, and peer permissions for the assigned share before distributing the remaining device packages."
        />

        <SectionHeader
          title="Profile Name"
          copy="A name for this profile to identify it in the peer list."
        />
        <TextField
          label="Profile Name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
        />

        <div className="assigned-share-card">
          <div className="assigned-share-head">
            <span className="check-disc">
              <Check size={15} />
            </span>
            <div>
              <div className="value">Assigned Local Share</div>
              <div className="help">
                The local share for this device is already assigned and ready
                for profile creation.
              </div>
            </div>
          </div>
          <div className="kv-row">
            <div>
              <div className="kicker">Local Share</div>
              <div className="value">
                Share #{rotatedLocalShare?.idx ?? 0}, Encrypted
              </div>
            </div>
            <div>
              <div className="kicker">Keyset</div>
              <div className="value">
                {rotatedGroup?.group_name ?? MOCK_SOURCE_SHARE_1.label}
              </div>
            </div>
          </div>
        </div>

        <div className="password-group">
          <SectionHeader
            title="Profile Password"
            copy="This password encrypts your profile on this device. You'll need it each time you unlock it."
            infoIcon
          />
          <div className="profile-password-row">
            <PasswordField
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordField
              label="Confirm Password"
              value={confirmPassword}
              checked={confirmMatches}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>

        <SectionHeader title="Relays" />
        <div className="relay-list">
          {relays.map((relay, index) => (
            <div className="relay-row" key={relay}>
              <div className="relay-details">
                <span className="value">{relay}</span>
                {index === 0 ? (
                  <span className="relay-status">Connected - 24ms latency</span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setRelays((cur) => cur.filter((r) => r !== relay))
                }
                aria-label={`Remove ${relay}`}
              >
                <X size={14} />
              </Button>
            </div>
          ))}
          <div className="relay-row relay-add-row">
            <span className="input-shell">
              <input
                className="input"
                value={relayInput}
                onChange={(e) => setRelayInput(e.target.value)}
              />
            </span>
            <Button
              type="button"
              className="relay-add-button"
              onClick={() => {
                const r = relayInput.trim();
                if (r && !relays.includes(r)) {
                  setRelays((cur) => [...cur, r]);
                  setRelayInput("wss://");
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <SectionHeader
          title="Peer Permissions"
          copy="Set default permissions for each peer. You can change these later in Settings."
        />
        <div className="permission-list">
          {members.map((member) => (
            <div className="permission-row" key={member.idx}>
              <div className="permission-main">
                <span className="value">
                  Peer #{member.idx}
                  {member.idx === rotatedLocalShare?.idx ? " (Local)" : ""}
                </span>
                {member.idx !== rotatedLocalShare?.idx ? (
                  <span className="help">
                    {member.pubkey.slice(0, 8)}...{member.pubkey.slice(-4)}
                  </span>
                ) : null}
              </div>
              <div className="inline-actions">
                <PeerPermissionTagGroup />
              </div>
            </div>
          ))}
        </div>

        {error ? <div className="error">{error}</div> : null}
        <Button
          type="button"
          size="full"
          disabled={busy || (Boolean(rotateKeysetSession) && !confirmMatches)}
          onClick={() => void handleContinue()}
        >
          {busy ? "Creating Profile..." : "Continue to Distribute Shares"}
        </Button>
      </div>
    </AppShell>
  );
}
