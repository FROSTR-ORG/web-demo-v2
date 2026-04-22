import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { AppStateProvider, useAppState, type AppStateValue } from "../AppState";
import {
  createKeysetBundle,
  createProfilePackagePair,
  decodeBfonboardPackage,
  decodeProfilePackage,
  deriveProfileIdFromShareSecret,
  encodeBfsharePackage,
  generateNsec,
  profilePayloadForShare,
  recoverNsecFromShares,
} from "../../lib/bifrost/packageService";
import { packagePasswordForShare } from "../../lib/bifrost/format";
import type {
  BfProfilePayload,
  StoredProfileRecord,
} from "../../lib/bifrost/types";
import { SetupFlowError } from "../AppState";

const storage = new Map<string, unknown>();

vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    storage.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));

const PROFILE_INDEX_KEY = "igloo.web-demo-v2.profile-index";
const PROFILE_RECORD_PREFIX = "igloo.web-demo-v2.profile.";

function Capture({ onState }: { onState: (state: AppStateValue) => void }) {
  const state = useAppState();
  useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

async function makeProfilePackage(
  options: { threshold?: number; count?: number; groupName?: string } = {},
) {
  const keyset = await createKeysetBundle({
    groupName: options.groupName ?? "Flow Key",
    threshold: options.threshold ?? 2,
    count: options.count ?? 3,
  });
  const localShare = keyset.shares[0];
  const profileId = await deriveProfileIdFromShareSecret(localShare.seckey);
  const payload = profilePayloadForShare({
    profileId,
    deviceName: "Flow Device",
    share: localShare,
    group: keyset.group,
    relays: ["wss://relay.example.test"],
  });
  const pair = await createProfilePackagePair(payload, "backup-password");
  return { keyset, localShare, profileId, payload, pair };
}

async function renderProvider() {
  let latest!: AppStateValue;
  render(
    <AppStateProvider>
      <Capture onState={(state) => (latest = state)} />
    </AppStateProvider>,
  );
  await waitFor(() => expect(latest).toBeTruthy());
  return () => latest;
}

beforeEach(() => {
  storage.clear();
});

afterEach(() => {
  cleanup();
  storage.clear();
});

describe("AppState setup flows", () => {
  it("creates from a generated nsec without storing the nsec in setup drafts or storage", async () => {
    const getState = await renderProvider();
    const generated = await generateNsec();

    await act(async () => {
      await getState().createKeyset({
        groupName: "Generated Create Key",
        threshold: 2,
        count: 3,
        generatedNsec: generated.nsec,
      });
    });
    await waitFor(() =>
      expect(getState().createSession?.keyset?.group.group_name).toBe(
        "Generated Create Key",
      ),
    );

    const session = getState().createSession!;
    expect(JSON.stringify(session.draft)).not.toContain(generated.nsec);
    expect(JSON.stringify(Array.from(storage.entries()))).not.toContain(
      generated.nsec,
    );

    const recovered = await recoverNsecFromShares({
      group: session.keyset!.group,
      shares: session.keyset!.shares.slice(0, session.keyset!.group.threshold),
    });
    expect(recovered.nsec).toBe(generated.nsec);

    act(() => {
      getState().clearCreateSession();
    });
    await waitFor(() => expect(getState().createSession).toBeNull());
  }, 45_000);

  it("splits a pasted existing nsec into a keyset whose group pubkey matches the nsec and whose shares round-trip to the pasted value (VAL-BACKUP-020 / m6-nsec-split-create)", async () => {
    const getState = await renderProvider();
    // Pretend the user pasted an existing nsec by generating one up-front
    // and feeding it into `createKeyset` via the `existingNsec` field.
    const pasted = await generateNsec();

    await act(async () => {
      await getState().createKeyset({
        groupName: "Pasted Nsec Key",
        threshold: 2,
        count: 3,
        existingNsec: pasted.nsec,
      });
    });
    await waitFor(() =>
      expect(getState().createSession?.keyset?.group.group_name).toBe(
        "Pasted Nsec Key",
      ),
    );

    const session = getState().createSession!;
    const keyset = session.keyset!;
    // The group pubkey is a BIP-340 x-only key derived from the pasted
    // nsec; we can't derive it directly from the secret without WASM, so
    // the round-trip recovery below is the canonical proof the pasted
    // nsec is the signing root (VAL-BACKUP-020).
    expect(keyset.group.group_pk).toMatch(/^[0-9a-f]{64}$/);

    // Any threshold of shares reconstructs the original pasted nsec.
    const recovered = await recoverNsecFromShares({
      group: keyset.group,
      shares: keyset.shares.slice(0, keyset.group.threshold),
    });
    expect(recovered.nsec).toBe(pasted.nsec);
    expect(recovered.signing_key_hex).toBe(pasted.signing_key_hex);

    // The pasted nsec must NOT appear in the in-memory create draft nor in
    // any idb-keyval store (VAL-BACKUP-023).
    expect(JSON.stringify(session.draft)).not.toContain(pasted.nsec);
    expect(JSON.stringify(Array.from(storage.entries()))).not.toContain(
      pasted.nsec,
    );

    act(() => {
      getState().clearCreateSession();
    });
    await waitFor(() => expect(getState().createSession).toBeNull());
  }, 45_000);

  it("creates real remote onboarding packages with one chosen distribution password and default peer policies", async () => {
    const getState = await renderProvider();

    await act(async () => {
      await getState().createKeyset({
        groupName: "Create Flow Key",
        threshold: 2,
        count: 2,
      });
    });
    await waitFor(() =>
      expect(getState().createSession?.keyset?.group.group_name).toBe(
        "Create Flow Key",
      ),
    );

    await act(async () => {
      await getState().createProfile({
        deviceName: "Create Browser",
        password: "local-password",
        confirmPassword: "local-password",
        distributionPassword: "remote-password",
        confirmDistributionPassword: "remote-password",
        relays: ["wss://relay.example.test"],
      });
    });

    await waitFor(() =>
      expect(getState().createSession?.onboardingPackages).toHaveLength(1),
    );
    const session = getState().createSession!;
    const remotePackage = session.onboardingPackages[0];
    await expect(
      decodeBfonboardPackage(remotePackage.packageText, "remote-password"),
    ).resolves.toMatchObject({
      relays: ["wss://relay.example.test"],
    });
    await expect(
      decodeBfonboardPackage(
        remotePackage.packageText,
        packagePasswordForShare("Create Flow Key", remotePackage.idx),
      ),
    ).rejects.toThrow();

    const record = storage.get(
      `${PROFILE_RECORD_PREFIX}${session.createdProfileId}`,
    ) as StoredProfileRecord;
    const decoded = await decodeProfilePackage(
      record.encryptedProfilePackage,
      "local-password",
    );
    expect(decoded.device.manual_peer_policy_overrides).toHaveLength(1);
    for (const override of decoded.device.manual_peer_policy_overrides) {
      expect(override.policy.request).toEqual({
        echo: "allow",
        ping: "allow",
        onboard: "allow",
        sign: "allow",
        ecdh: "allow",
      });
      expect(override.policy.respond).toEqual({
        echo: "allow",
        ping: "allow",
        onboard: "allow",
        sign: "allow",
        ecdh: "allow",
      });
    }
    expect(JSON.stringify(record)).not.toMatch(/share_secret|seckey/);

    act(() => {
      getState().clearCreateSession();
    });
    await waitFor(() => expect(getState().createSession).toBeNull());
  }, 45_000);

  it("imports a generated bfprofile, stores only encrypted profile material, and unlocks after reload", async () => {
    const generated = await makeProfilePackage();
    let getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await waitFor(() =>
      expect(getState().importSession?.payload?.profile_id).toBe(
        generated.profileId,
      ),
    );

    let savedProfileId = "";
    await act(async () => {
      savedProfileId = await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });

    expect(savedProfileId).toBe(generated.profileId);
    const ids = storage.get(PROFILE_INDEX_KEY) as string[];
    expect(ids).toEqual([generated.profileId]);
    const record = storage.get(
      `${PROFILE_RECORD_PREFIX}${generated.profileId}`,
    ) as StoredProfileRecord;
    expect(record.encryptedProfilePackage.startsWith("bfprofile1")).toBe(true);
    expect(JSON.stringify(record.summary)).not.toMatch(/share_secret|seckey/);

    cleanup();
    getState = await renderProvider();
    await waitFor(() =>
      expect(getState().profiles.map((profile) => profile.id)).toContain(
        generated.profileId,
      ),
    );
    await act(async () => {
      await getState().unlockProfile(generated.profileId, "local-password");
    });
    await waitFor(() =>
      expect(getState().activeProfile?.id).toBe(generated.profileId),
    );
  }, 45_000);

  it("requires explicit confirmation before replacing an imported profile conflict", async () => {
    const generated = await makeProfilePackage();
    const getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await act(async () => {
      await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });
    act(() => {
      getState().clearImportSession();
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await waitFor(() =>
      expect(getState().importSession?.conflictProfile?.id).toBe(
        generated.profileId,
      ),
    );

    await expect(
      getState().saveImportedProfile({
        password: "replacement-password",
        confirmPassword: "replacement-password",
      }),
    ).rejects.toMatchObject({
      code: "profile_conflict",
    });

    await act(async () => {
      await getState().saveImportedProfile({
        password: "replacement-password",
        confirmPassword: "replacement-password",
        replaceExisting: true,
      });
    });

    const ids = storage.get(PROFILE_INDEX_KEY) as string[];
    expect(ids).toEqual([generated.profileId]);
    act(() => {
      getState().clearImportSession();
    });
    await waitFor(() => expect(getState().importSession).toBeNull());
  }, 45_000);

  it("recovers a real nsec from a saved 2-of-2 profile and clears the memory-only session", async () => {
    const generated = await makeProfilePackage({ threshold: 2, count: 2 });
    const getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await act(async () => {
      await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });

    const externalSharePackage = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "source-password",
    );

    await expect(
      getState().validateRecoverSources({
        profileId: generated.profileId,
        profilePassword: "wrong-password",
        sourcePackages: [
          { packageText: externalSharePackage, password: "source-password" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "wrong_password",
      details: { source: "saved_profile" },
    });

    await act(async () => {
      await getState().validateRecoverSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: externalSharePackage, password: "source-password" },
        ],
      });
    });
    await waitFor(() =>
      expect(getState().recoverSession?.sources).toHaveLength(2),
    );

    let recoveredNsec = "";
    await act(async () => {
      recoveredNsec = (await getState().recoverNsec()).nsec;
    });
    expect(recoveredNsec.startsWith("nsec1")).toBe(true);
    expect(getState().recoverSession?.recovered?.signing_key_hex).toHaveLength(
      64,
    );
    expect(getState().recoverSession?.expiresAt).toBeGreaterThan(Date.now());

    const record = storage.get(
      `${PROFILE_RECORD_PREFIX}${generated.profileId}`,
    ) as StoredProfileRecord;
    expect(JSON.stringify(record)).not.toContain(recoveredNsec);
    expect(JSON.stringify(record.summary)).not.toMatch(
      /share_secret|seckey|nsec/,
    );

    act(() => {
      getState().expireRecoveredNsec();
    });
    await waitFor(() => expect(getState().recoverSession).toBeNull());
  }, 45_000);

  it("recovers a threshold-3 profile and reports duplicate or mismatched recovery shares", async () => {
    const generated = await makeProfilePackage({ threshold: 3, count: 5 });
    const other = await makeProfilePackage({ groupName: "Other Recovery Key" });
    const getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await act(async () => {
      await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });

    const firstExternal = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "first-source-password",
    );
    const secondExternal = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[2].seckey,
        relays: ["wss://relay.example.test"],
      },
      "second-source-password",
    );

    await expect(
      getState().validateRecoverSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: firstExternal, password: "first-source-password" },
          { packageText: firstExternal, password: "first-source-password" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "duplicate_share",
    });

    const mismatchedExternal = await encodeBfsharePackage(
      {
        share_secret: other.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "mismatch-password",
    );
    await expect(
      getState().validateRecoverSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: firstExternal, password: "first-source-password" },
          { packageText: mismatchedExternal, password: "mismatch-password" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "group_mismatch",
    });

    await act(async () => {
      await getState().validateRecoverSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: firstExternal, password: "first-source-password" },
          { packageText: secondExternal, password: "second-source-password" },
        ],
      });
    });
    await waitFor(() =>
      expect(getState().recoverSession?.externalShares).toHaveLength(2),
    );

    let recoveredNsec = "";
    await act(async () => {
      recoveredNsec = (await getState().recoverNsec()).nsec;
    });
    expect(recoveredNsec.startsWith("nsec1")).toBe(true);

    act(() => {
      getState().clearRecoverSession();
    });
    await waitFor(() => expect(getState().recoverSession).toBeNull());
  }, 45_000);

  it("rotates an imported threshold-3 profile from enough bfshare sources and replaces the stored profile", async () => {
    const generated = await makeProfilePackage({ threshold: 3, count: 5 });
    const getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await waitFor(() =>
      expect(getState().importSession?.payload?.profile_id).toBe(
        generated.profileId,
      ),
    );
    await act(async () => {
      await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });

    const externalSharePackage = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "source-password",
    );
    const secondExternalSharePackage = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[2].seckey,
        relays: ["wss://relay.example.test"],
      },
      "second-source-password",
    );

    await act(async () => {
      await getState().validateRotateKeysetSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: externalSharePackage, password: "source-password" },
          {
            packageText: secondExternalSharePackage,
            password: "second-source-password",
          },
        ],
        threshold: 3,
        count: 5,
      });
    });
    await waitFor(() =>
      expect(getState().rotateKeysetSession?.sourceShares).toHaveLength(3),
    );

    await act(async () => {
      await getState().generateRotatedKeyset("dist-password");
    });
    await waitFor(() =>
      expect(getState().rotateKeysetSession?.rotated?.next.group.group_pk).toBe(
        generated.keyset.group.group_pk,
      ),
    );

    let rotatedProfileId = "";
    await act(async () => {
      rotatedProfileId = await getState().createRotatedProfile({
        deviceName: "Rotated Device",
        password: "rotated-password",
        confirmPassword: "rotated-password",
        relays: ["wss://relay.example.test"],
      });
    });

    expect(rotatedProfileId).not.toBe(generated.profileId);
    expect(
      storage.get(`${PROFILE_RECORD_PREFIX}${generated.profileId}`),
    ).toBeUndefined();
    const ids = storage.get(PROFILE_INDEX_KEY) as string[];
    expect(ids).toEqual([rotatedProfileId]);
    const record = storage.get(
      `${PROFILE_RECORD_PREFIX}${rotatedProfileId}`,
    ) as StoredProfileRecord;
    expect(record.summary.groupPublicKey).toBe(generated.keyset.group.group_pk);
    expect(JSON.stringify(record.summary)).not.toMatch(/share_secret|seckey/);
    const decodedRotated = await decodeProfilePackage(
      record.encryptedProfilePackage,
      "rotated-password",
    );
    expect(decodedRotated.device.manual_peer_policy_overrides).toHaveLength(4);

    const rotatedPackage =
      getState().rotateKeysetSession!.onboardingPackages[0];
    await expect(
      decodeBfonboardPackage(rotatedPackage.packageText, "dist-password"),
    ).resolves.toMatchObject({
      relays: ["wss://relay.example.test"],
    });
    await expect(
      decodeBfonboardPackage(
        rotatedPackage.packageText,
        packagePasswordForShare("Flow Key", rotatedPackage.idx),
      ),
    ).rejects.toThrow();

    act(() => {
      for (const pkg of getState().rotateKeysetSession!.onboardingPackages) {
        getState().updateRotatePackageState(pkg.idx, {
          packageCopied: true,
          passwordCopied: true,
        });
      }
    });
    await waitFor(() =>
      expect(getState().rotateKeysetSession?.phase).toBe("distribution_ready"),
    );

    await act(async () => {
      await getState().finishRotateDistribution();
    });
    await waitFor(() => expect(getState().rotateKeysetSession).toBeNull());
  }, 45_000);

  it("reports duplicate and mismatched rotate bfshare sources with stable setup errors", async () => {
    const generated = await makeProfilePackage();
    const other = await makeProfilePackage({ groupName: "Other Flow Key" });
    const getState = await renderProvider();

    act(() => {
      getState().beginImport(generated.pair.profile_string);
    });
    await act(async () => {
      await getState().decryptImportBackup(
        generated.pair.profile_string,
        "backup-password",
      );
    });
    await act(async () => {
      await getState().saveImportedProfile({
        password: "local-password",
        confirmPassword: "local-password",
      });
    });

    const duplicatePackage = await encodeBfsharePackage(
      {
        share_secret: generated.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "source-password",
    );
    await expect(
      getState().validateRotateKeysetSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: duplicatePackage, password: "source-password" },
          { packageText: duplicatePackage, password: "source-password" },
        ],
        threshold: 2,
        count: 3,
      }),
    ).rejects.toMatchObject({
      code: "duplicate_share",
      details: { sourceIndex: 3, shareIndex: generated.keyset.shares[1].idx },
    });

    const mismatchedPackage = await encodeBfsharePackage(
      {
        share_secret: other.keyset.shares[1].seckey,
        relays: ["wss://relay.example.test"],
      },
      "source-password",
    );
    await expect(
      getState().validateRotateKeysetSources({
        profileId: generated.profileId,
        profilePassword: "local-password",
        sourcePackages: [
          { packageText: mismatchedPackage, password: "source-password" },
        ],
        threshold: 2,
        count: 3,
      }),
    ).rejects.toMatchObject({ code: "group_mismatch" });
    await expect(
      getState().validateRotateKeysetSources({
        profileId: generated.profileId,
        profilePassword: "wrong-password",
        sourcePackages: [
          { packageText: duplicatePackage, password: "source-password" },
        ],
        threshold: 2,
        count: 3,
      }),
    ).rejects.toMatchObject({
      code: "wrong_password",
      details: { source: "saved_profile" },
    });
  }, 45_000);
});
