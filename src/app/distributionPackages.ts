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
        packageCopied: false,
        passwordCopied: false,
        copied: false,
        qrShown: false
      };
    })
  );
}

export function normalizePackageStatePatch(patch: PackageStatePatch): PackageStatePatch {
  return patch.copied ? { ...patch, packageCopied: true } : patch;
}

export function packageDistributed(entry: Pick<OnboardingPackageView, "packageCopied" | "passwordCopied" | "copied" | "qrShown">): boolean {
  return (entry.packageCopied || entry.copied || entry.qrShown) && entry.passwordCopied;
}

export function allPackagesDistributed(packages: OnboardingPackageView[]): boolean {
  return packages.length > 0 && packages.every(packageDistributed);
}
