import type { FormEvent, ReactNode } from "react";
import { Check, X } from "lucide-react";
import {
  PEER_PERMISSION_META,
  PeerPermissionTagGroup,
  type PeerPermissionMethod,
  type PeerPermissionValues,
} from "../components/PeerPermissionTags";
import { BackLink, Button, PasswordField, SectionHeader, Stepper } from "../components/ui";
import { PageHeading } from "../components/shell";
import { shortHex } from "../lib/bifrost/format";

interface ProfileSetupMember {
  idx: number;
  pubkey: string;
}

interface ProfileSetupFormProps {
  stepperVariant: "shared" | "rotate-keyset";
  profileName: string;
  password: string;
  confirmPassword: string;
  relays: string[];
  relayInput: string;
  localShareIdx: number;
  keysetName: ReactNode;
  members: ProfileSetupMember[];
  busy: boolean;
  error?: string;
  submitType?: "submit" | "button";
  continueDisabled?: boolean;
  onBack: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onContinue?: () => void;
  onProfileNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onRelayInputChange: (value: string) => void;
  onRelayAdd: () => void;
  onRelayRemove: (relay: string) => void;
  peerPermissionValues?: (idx: number) => PeerPermissionValues | undefined;
  onPeerPermissionToggle?: (idx: number, method: PeerPermissionMethod, nextValue: boolean) => void;
}

export function ProfileSetupForm({
  stepperVariant,
  profileName,
  password,
  confirmPassword,
  relays,
  relayInput,
  localShareIdx,
  keysetName,
  members,
  busy,
  error,
  submitType = "submit",
  continueDisabled,
  onBack,
  onSubmit,
  onContinue,
  onProfileNameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onRelayInputChange,
  onRelayAdd,
  onRelayRemove,
  peerPermissionValues,
  onPeerPermissionToggle,
}: ProfileSetupFormProps) {
  const confirmMatches = password.length > 0 && password === confirmPassword;
  const content = (
    <>
      <Stepper current={2} variant={stepperVariant} />
      <BackLink onClick={onBack} />
      <PageHeading
        title="Create Profile"
        copy="Set the local profile name, password, relays, and peer permissions for the assigned share before distributing the remaining device packages."
      />
      <SectionHeader title="Profile Name" copy="A name for this profile to identify it in the peer list." />
      <label className="field profile-name-field">
        <span className="sr-only">Profile Name</span>
        <span className="input-shell">
          <input className="input" value={profileName} onChange={(event) => onProfileNameChange(event.target.value)} />
        </span>
      </label>

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
            <div className="value">Share #{localShareIdx}, Encrypted</div>
          </div>
          <div>
            <div className="kicker">Keyset</div>
            <div className="value">{keysetName}</div>
          </div>
        </div>
      </div>

      <div className="password-group">
        <SectionHeader title="Profile Password" copy="This password encrypts your profile on this device. You'll need it each time you unlock it." infoIcon />
        <div className="profile-password-row">
          <PasswordField label="Password" value={password} onChange={(event) => onPasswordChange(event.target.value)} />
          <PasswordField
            label="Confirm Password"
            value={confirmPassword}
            checked={confirmMatches}
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
          />
        </div>
      </div>

      <SectionHeader title="Relays" />
      <div className="relay-list">
        {relays.map((relay, index) => (
          <div className="relay-row" key={relay}>
            <div className="relay-details">
              <span className="value">{relay}</span>
              {index === 0 ? <span className="relay-status">Status unavailable</span> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRelayRemove(relay)}
              aria-label={`Remove ${relay}`}
            >
              <X size={14} />
            </Button>
          </div>
        ))}
        <div className="relay-row relay-add-row">
          <span className="input-shell">
            <input className="input" value={relayInput} onChange={(event) => onRelayInputChange(event.target.value)} />
          </span>
          <Button type="button" className="relay-add-button" onClick={onRelayAdd}>
            Add
          </Button>
        </div>
      </div>

      <SectionHeader title="Peer Permissions" copy="Set default permissions for each peer. You can change these later in Settings." />
      <div className="permission-list">
        {members.map((member) => (
          <div className="permission-row" key={`${member.idx}-${member.pubkey}`}>
            <div className="permission-main">
              <span className="value">Peer #{member.idx}</span>
              {member.idx === localShareIdx ? null : <span className="help">{shortHex(member.pubkey, 8, 4)}</span>}
            </div>
            <div className="inline-actions permission-toggles">
              {onPeerPermissionToggle && member.idx !== localShareIdx ? (
                <PeerPermissionTagGroup
                  interactive
                  values={peerPermissionValues?.(member.idx)}
                  onToggle={(method, nextValue) => onPeerPermissionToggle(member.idx, method, nextValue)}
                  ariaLabel={(method, active) =>
                    `${active ? "Disable" : "Enable"} ${PEER_PERMISSION_META[method].label} for Peer #${member.idx}`
                  }
                />
              ) : (
                <PeerPermissionTagGroup values={peerPermissionValues?.(member.idx)} />
              )}
            </div>
          </div>
        ))}
      </div>

      {error ? <div className="error">{error}</div> : null}
      <Button
        type={submitType}
        size="full"
        disabled={busy || continueDisabled || (submitType === "submit" && !confirmMatches)}
        onClick={submitType === "button" ? onContinue : undefined}
      >
        {busy ? "Creating Profile..." : "Continue to Distribute Shares"}
      </Button>
    </>
  );

  if (onSubmit) {
    return (
      <form className="screen-column profile-setup-column" onSubmit={onSubmit}>
        {content}
      </form>
    );
  }

  return <div className="screen-column profile-setup-column">{content}</div>;
}
