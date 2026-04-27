import { Check, Copy, LayoutDashboard, QrCode, Radio, Users } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../../../app/AppState";
import {
  DEMO_PASSWORD_MIN_LENGTH,
  PACKAGE_PASSWORD_TOO_SHORT_ERROR,
} from "../../../app/AppStateTypes";
import { DEFAULT_RELAYS } from "../../../app/profileDrafts";
import { Button, NumberStepper, StatusPill, TextField } from "../../../components/ui";
import type { OnboardingPackageView, RuntimeStatusSummary } from "../../../lib/bifrost/types";
import { normalizeRelayKey, normalizeRelayList, validateRelayUrl } from "../../../lib/relay/relayUrl";

const MAX_TEST_GROUP_MEMBERS = 20;
const DEFAULT_TEST_GROUP_PASSWORD = "1234";

function isPublicWssRelayUrl(relay: string): boolean {
  try {
    const parsed = new URL(validateRelayUrl(relay));
    const hostname = parsed.hostname.toLowerCase();
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, aRaw, bRaw] = ipv4Match;
      const a = Number(aRaw);
      const b = Number(bRaw);
      if (
        a === 10 ||
        a === 127 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        a === 0
      ) {
        return false;
      }
    }
    return (
      parsed.protocol.toLowerCase() === "wss:" &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      hostname !== "[::1]" &&
      !hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function resolveTestGroupRelays(
  activeRelays: readonly string[] | undefined,
  tunnelRelay: string,
): string[] {
  const baseRelays = normalizeRelayList(activeRelays ?? [], {
    onValidatorError: "skip",
  }).filter(isPublicWssRelayUrl);
  const relays = baseRelays.length > 0 ? baseRelays : [...DEFAULT_RELAYS];
  const trimmedTunnel = tunnelRelay.trim();
  if (trimmedTunnel && isPublicWssRelayUrl(trimmedTunnel)) {
    const tunnelKey = normalizeRelayKey(trimmedTunnel);
    if (!relays.some((relay) => normalizeRelayKey(relay) === tunnelKey)) {
      relays.push(trimmedTunnel);
    }
  }
  return relays;
}

function packageLabel(
  pkg: OnboardingPackageView,
  runtimeStatus: RuntimeStatusSummary | null | undefined,
): string {
  const trimmedDeviceLabel = pkg.deviceLabel?.trim();
  if (trimmedDeviceLabel) return trimmedDeviceLabel;
  const runtimePeer = runtimeStatus?.peers.find(
    (peer) => peer.pubkey.toLowerCase() === pkg.memberPubkey.toLowerCase(),
  ) as
    | {
        device_label?: string;
        deviceLabel?: string;
        label?: string;
        name?: string;
      }
    | undefined;
  return (
    runtimePeer?.device_label?.trim() ||
    runtimePeer?.deviceLabel?.trim() ||
    runtimePeer?.label?.trim() ||
    runtimePeer?.name?.trim() ||
    `Share ${pkg.idx}`
  );
}

async function copySecret(value: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // Clipboard can be unavailable in preview/test contexts. The stage
    // workflow is QR-first, so a clipboard miss should not block the page.
  }
}

export function TestGroupPanel() {
  const navigate = useNavigate();
  const {
    activeProfile,
    runtimeStatus,
    createSession,
    createTestGroup,
    markPackageDistributed,
    getCreateSessionPackageSecret,
  } = useAppState();
  const [groupName, setGroupName] = useState("");
  const [threshold, setThreshold] = useState(2);
  const [count, setCount] = useState(5);
  const [password, setPassword] = useState(DEFAULT_TEST_GROUP_PASSWORD);
  const [tunnelRelay, setTunnelRelay] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const activeTestSession =
    activeProfile &&
    createSession?.createdProfileId === activeProfile.id &&
    createSession.onboardingPackages.length > 0
      ? createSession
      : null;
  const packages = activeTestSession?.onboardingPackages ?? [];
  const joinedCount = packages.filter((pkg) => pkg.manuallyMarkedDistributed).length;
  const requestSeenCount = packages.filter(
    (pkg) => pkg.peerOnline && !pkg.manuallyMarkedDistributed,
  ).length;
  const totalRemoteCount = packages.length;
  const stagePassword =
    packages
      .map((pkg) => getCreateSessionPackageSecret(pkg.idx)?.password)
      .find((value): value is string => Boolean(value)) ||
    (activeTestSession ? password : DEFAULT_TEST_GROUP_PASSWORD);
  const tunnelRelayError =
    tunnelRelay.trim().length > 0 && !isPublicWssRelayUrl(tunnelRelay)
      ? "Tunnel relay must be a public wss:// URL."
      : "";
  const previewRelays = useMemo(
    () => resolveTestGroupRelays(activeProfile?.relays, tunnelRelay),
    [activeProfile?.relays, tunnelRelay],
  );

  const formInvalid =
    creating ||
    count < 2 ||
    count > MAX_TEST_GROUP_MEMBERS ||
    threshold < 2 ||
    threshold > count ||
    password.length < DEMO_PASSWORD_MIN_LENGTH ||
    Boolean(tunnelRelayError);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (count < 2) {
      setError("Total members must be at least 2.");
      return;
    }
    if (count > MAX_TEST_GROUP_MEMBERS) {
      setError("Test groups support at most 20 members.");
      return;
    }
    if (threshold < 2 || threshold > count) {
      setError("Threshold must be between 2 and total members.");
      return;
    }
    if (password.length < DEMO_PASSWORD_MIN_LENGTH) {
      setError(PACKAGE_PASSWORD_TOO_SHORT_ERROR);
      return;
    }
    if (tunnelRelayError) {
      setError(tunnelRelayError);
      return;
    }
    setCreating(true);
    try {
      const result = await createTestGroup({
        groupName,
        threshold,
        count,
        password,
        extraRelays: tunnelRelay.trim() ? [tunnelRelay.trim()] : [],
      });
      navigate(`/dashboard/${result.profileId}/test`, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to create test group.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (activeTestSession && activeProfile) {
    return (
      <section className="test-group-panel" data-testid="test-group-panel">
        <div className="test-group-stage-bar">
          <div className="test-group-stage-title">
            <span className="test-group-stage-icon" aria-hidden="true">
              <Users size={16} />
            </span>
            <span>{activeTestSession.draft.groupName}</span>
          </div>
          <div className="test-group-stage-stats">
            <span>{activeTestSession.draft.threshold}-of-{activeTestSession.draft.count}</span>
            <span>{joinedCount}/{totalRemoteCount} joined</span>
            {requestSeenCount > 0 ? <span>{requestSeenCount} request seen</span> : null}
            <span>Password: <strong>{stagePassword}</strong></span>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/dashboard/${activeProfile.id}`)}
          >
            <LayoutDashboard size={14} />
            Go to Dashboard
          </Button>
        </div>

        <div className="test-group-package-list" aria-label="Test group onboarding packages">
          {packages.map((pkg) => {
            const secret = getCreateSessionPackageSecret(pkg.idx);
            const packageText = secret?.packageText ?? pkg.packageText;
            return (
              <TestGroupPackageCard
                key={pkg.idx}
                pkg={pkg}
                label={packageLabel(pkg, runtimeStatus)}
                packageText={packageText}
                onCopy={() => void copySecret(packageText)}
                onMarkJoined={() => markPackageDistributed(pkg.idx)}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-pad test-group-panel" data-testid="test-group-panel">
      <div className="test-group-form-head">
        <div>
          <div className="value">Test Group</div>
          <p className="help">
            Create a real stage keyset, keep the organizer share here, and show every participant package at once.
          </p>
        </div>
        <StatusPill tone="info">Stage relays</StatusPill>
      </div>

      <form className="test-group-form" onSubmit={onSubmit}>
        <TextField
          label="Group name"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          placeholder="Test Group"
          help="Blank uses Test Group."
        />
        <div className="test-group-stepper-grid">
          <NumberStepper
            label="Threshold"
            value={threshold}
            min={2}
            max={count}
            onChange={setThreshold}
          />
          <NumberStepper
            label="Total members"
            value={count}
            min={2}
            max={MAX_TEST_GROUP_MEMBERS}
            onChange={(nextCount) => {
              setCount(nextCount);
              setThreshold((current) => Math.min(current, nextCount));
            }}
          />
        </div>
        <TextField
          label="Shared onboarding password"
          type="text"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={
            password.length < DEMO_PASSWORD_MIN_LENGTH
              ? PACKAGE_PASSWORD_TOO_SHORT_ERROR
              : undefined
          }
          help="Shown once on the stage page."
        />
        <TextField
          label="Tunnel relay"
          type="text"
          value={tunnelRelay}
          onChange={(event) => setTunnelRelay(event.target.value)}
          placeholder="wss://your-ngrok-url.ngrok-free.app"
          error={tunnelRelayError || undefined}
          help="Optional phone-reachable relay, for example an ngrok WebSocket tunnel."
        />
        <div className="test-group-relay-preview" aria-label="Final relay list">
          <div className="test-group-relay-preview-title">Final relay list</div>
          <div className="test-group-relay-list">
            {previewRelays.map((relay) => (
              <code key={normalizeRelayKey(relay)}>{relay}</code>
            ))}
          </div>
        </div>
        {error ? (
          <div className="error" role="alert" data-testid="test-group-error">
            {error}
          </div>
        ) : null}
        <Button type="submit" size="full" disabled={formInvalid}>
          {creating ? "Creating Test Group..." : "Create Test Group"}
        </Button>
      </form>
    </section>
  );
}

function TestGroupPackageCard({
  pkg,
  label,
  packageText,
  onCopy,
  onMarkJoined,
}: {
  pkg: OnboardingPackageView;
  label: string;
  packageText: string;
  onCopy: () => void;
  onMarkJoined: () => void;
}) {
  if (pkg.manuallyMarkedDistributed) {
    return (
      <div className="test-group-joined-row" data-testid={`test-group-joined-${pkg.idx}`}>
        <div className="test-group-joined-label">
          <Check size={15} />
          <span>{label}</span>
        </div>
        <StatusPill tone="success" marker="check">
          Joined
        </StatusPill>
      </div>
    );
  }

  return (
    <article className="test-group-package-card" data-testid={`test-group-package-${pkg.idx}`}>
      <div className="test-group-package-copy">
        <div className="test-group-package-title-row">
          <div>
            <div className="test-group-package-title">{label}</div>
            <div className="test-group-package-subtitle">Share index {pkg.idx}</div>
          </div>
          <StatusPill tone={pkg.adoptionError ? "error" : pkg.peerOnline ? "info" : "warning"}>
            {pkg.adoptionError ? "Needs attention" : pkg.peerOnline ? "Request seen" : "Waiting"}
          </StatusPill>
        </div>
        {pkg.adoptionError ? (
          <p className="error" role="alert">
            {pkg.adoptionError}
          </p>
        ) : pkg.peerOnline ? (
          <p className="help">
            Source saw this share request. Keep this QR available until the participant confirms completion.
          </p>
        ) : (
          <p className="help">
            Participant scans this package, then enters the shared password.
          </p>
        )}
        <div className="test-group-package-actions">
          <Button type="button" variant="chip" size="sm" onClick={onCopy}>
            <Copy size={13} />
            Copy package
          </Button>
          <Button type="button" variant="chip" size="sm" onClick={onMarkJoined}>
            {pkg.peerOnline ? <Radio size={13} /> : <Check size={13} />}
            Mark joined
          </Button>
        </div>
      </div>
      <div className="test-group-qr-wrap">
        <QrCode className="test-group-qr-placeholder" size={22} aria-hidden="true" />
        <InlineQr value={packageText} />
      </div>
    </article>
  );
}

function InlineQr({ value }: { value: string }) {
  const [url, setUrl] = useState("");
  const stableValue = useMemo(() => value, [value]);

  useEffect(() => {
    let active = true;
    setUrl("");
    if (!stableValue) return;
    QRCode.toDataURL(stableValue, { margin: 1, width: 336 }).then((nextUrl) => {
      if (active) {
        setUrl(nextUrl);
      }
    });
    return () => {
      active = false;
    };
  }, [stableValue]);

  return url ? (
    <img className="test-group-qr-img" src={url} alt="QR code for onboarding package" />
  ) : (
    <div className="test-group-qr-loading">Generating QR...</div>
  );
}
