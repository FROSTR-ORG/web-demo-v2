import { memberForShare, memberPubkeyXOnly } from "../lib/bifrost/format";
import { encodeOnboardPackage, onboardPayloadForRemoteShare } from "../lib/bifrost/packageService";
import type {
  GroupPackageWire,
  OnboardingPackageView,
  SharePackageWire
} from "../lib/bifrost/types";

export type PackageStatePatch = Partial<Pick<OnboardingPackageView, "packageCopied" | "passwordCopied" | "copied" | "qrShown">>;

export async function buildRemoteOnboardingPackages(input: {
  remoteShares: SharePackageWire[];
  localShare: SharePackageWire;
  group: GroupPackageWire;
  relays: string[];
  password: string;
}): Promise<OnboardingPackageView[]> {
  return Promise.all(
    input.remoteShares.map(async (remoteShare) => {
      const payload = onboardPayloadForRemoteShare({
        remoteShare,
        localShare: input.localShare,
        group: input.group,
        relays: input.relays
      });
      const packageText = await encodeOnboardPackage(payload, input.password);
      return {
        idx: remoteShare.idx,
        memberPubkey: memberPubkeyXOnly(memberForShare(input.group, remoteShare)),
        packageText,
        password: input.password,
        // fix-followup-distribute-2a — legacy flow (rotate-keyset) still
        // eager-encrypts onboarding packages at keyset build time, so
        // those entries are created with packageCreated=true up front.
        // The Create flow now defers package creation to
        // encodeDistributionPackage(idx, password) and constructs the
        // initial view via buildPendingOnboardingPackageView() instead
        // of this helper.
        packageCreated: true,
        peerOnline: false,
        manuallyMarkedDistributed: false,
        packageCopied: false,
        passwordCopied: false,
        copied: false,
        qrShown: false
      };
    })
  );
}

/**
 * fix-followup-distribute-2a — construct an initial {@link OnboardingPackageView}
 * for a remote share BEFORE the package text has been encoded. Used by
 * the Create flow's `createProfile` mutator to populate
 * `createSession.onboardingPackages` with a "Package not created"
 * placeholder per remote share. Callers subsequently invoke
 * `encodeDistributionPackage(idx, password)` to flip `packageCreated`
 * to true and populate the redacted preview.
 */
export function buildPendingOnboardingPackageView(input: {
  remoteShare: SharePackageWire;
  group: GroupPackageWire;
}): OnboardingPackageView {
  return {
    idx: input.remoteShare.idx,
    memberPubkey: memberPubkeyXOnly(memberForShare(input.group, input.remoteShare)),
    packageText: "",
    password: "",
    packageCreated: false,
    peerOnline: false,
    manuallyMarkedDistributed: false,
    packageCopied: false,
    passwordCopied: false,
    copied: false,
    qrShown: false
  };
}

export function normalizePackageStatePatch(patch: PackageStatePatch): PackageStatePatch {
  return patch.copied ? { ...patch, packageCopied: true } : patch;
}

/**
 * fix-followup-distribute-2a — a remote share counts as "distributed"
 * only when the paired peer has come online (echo observed) OR the
 * user has manually confirmed hand-off via "Mark distributed". The
 * Copy package / Copy password / QR-shown sub-states are INFORMATIONAL
 * ONLY and do not — by themselves — advance the status chip.
 * (VAL-FOLLOWUP-006)
 */
export function packageDistributed(entry: Pick<OnboardingPackageView, "peerOnline" | "manuallyMarkedDistributed">): boolean {
  return entry.peerOnline === true || entry.manuallyMarkedDistributed === true;
}

export function allPackagesDistributed(packages: OnboardingPackageView[]): boolean {
  return packages.length > 0 && packages.every(packageDistributed);
}
