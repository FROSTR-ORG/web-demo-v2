import { memberForShare, memberPubkeyXOnly } from "../lib/bifrost/format";
import {
  decodeBfsharePackage,
  decodeProfilePackage,
  resolveShareIndex
} from "../lib/bifrost/packageService";
import type {
  BfProfilePayload,
  BfSharePayload,
  GroupPackageWire,
  SharePackageWire,
  StoredProfileRecord
} from "../lib/bifrost/types";
import { getProfile } from "../lib/storage/profileStore";
import type { RecoverSourceSummary } from "./AppStateTypes";
import { SetupFlowError } from "./AppStateTypes";
import { setupErrorFromPackage } from "./setupFlowErrors";

export interface SourcePackageInput {
  packageText: string;
  password: string;
}

export async function loadSavedProfileSource(input: {
  profileId: string;
  profilePassword: string;
}): Promise<{
  record: StoredProfileRecord;
  sourcePayload: BfProfilePayload;
  localIdx: number;
  localShare: SharePackageWire;
}> {
  const record = await getProfile(input.profileId);
  if (!record) {
    throw new SetupFlowError("missing_session", "Saved profile was not found.");
  }

  let sourcePayload: BfProfilePayload;
  try {
    sourcePayload = await decodeProfilePackage(record.encryptedProfilePackage, input.profilePassword);
  } catch (error) {
    throw setupErrorFromPackage(error, {
      code: "wrong_password",
      message: "The profile password could not decrypt Source Share #1.",
      details: { source: "saved_profile" }
    });
  }

  const localIdx = await resolveShareIndex(sourcePayload.group_package, sourcePayload.device.share_secret);
  const localShare: SharePackageWire = {
    idx: localIdx,
    seckey: sourcePayload.device.share_secret
  };
  return { record, sourcePayload, localIdx, localShare };
}

export async function decodeExternalBfshareSources(input: {
  group: GroupPackageWire;
  sourcePackages: SourcePackageInput[];
  seenShareIndexes: Set<number>;
  displayIndexOffset?: number;
}): Promise<{ shares: SharePackageWire[]; sources: RecoverSourceSummary[] }> {
  const shares: SharePackageWire[] = [];
  const sources: RecoverSourceSummary[] = [];
  const displayIndexOffset = input.displayIndexOffset ?? 2;

  for (const [sourceIndex, source] of input.sourcePackages.entries()) {
    const displayIndex = sourceIndex + displayIndexOffset;
    const packageText = source.packageText.trim();
    if (!packageText) {
      throw new SetupFlowError(
        "invalid_package",
        `Source Share #${displayIndex} bfshare package is required.`,
        { source: "bfshare", sourceIndex: displayIndex }
      );
    }
    if (!packageText.startsWith("bfshare1")) {
      throw new SetupFlowError(
        "invalid_package",
        `Source Share #${displayIndex} must be a bfshare package.`,
        { source: "bfshare", sourceIndex: displayIndex }
      );
    }

    let decoded: BfSharePayload;
    try {
      decoded = await decodeBfsharePackage(packageText, source.password);
    } catch (error) {
      throw setupErrorFromPackage(error, {
        code: "wrong_password",
        message: "Unable to decrypt this bfshare source package.",
        details: { source: "bfshare", sourceIndex: displayIndex }
      });
    }

    let idx: number;
    try {
      idx = await resolveShareIndex(input.group, decoded.share_secret);
    } catch (error) {
      throw new SetupFlowError(
        "group_mismatch",
        error instanceof Error ? error.message : "This bfshare source package does not belong to the selected group.",
        { source: "bfshare", sourceIndex: displayIndex, groupPublicKey: input.group.group_pk }
      );
    }
    if (input.seenShareIndexes.has(idx)) {
      throw new SetupFlowError(
        "duplicate_share",
        "This source share has already been collected.",
        { source: "bfshare", sourceIndex: displayIndex, shareIndex: idx }
      );
    }

    const externalShare = { idx, seckey: decoded.share_secret };
    input.seenShareIndexes.add(idx);
    shares.push(externalShare);
    sources.push({
      idx,
      memberPubkey: memberPubkeyXOnly(memberForShare(input.group, externalShare)),
      relays: decoded.relays
    });
  }

  return { shares, sources };
}
