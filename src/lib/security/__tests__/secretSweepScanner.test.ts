/**
 * Unit tests for `scanSnapshot` / `scanSnapshotSet` — the scanner
 * powering the m7 security live sweep (feature
 * `m7-security-live-sweep`). These tests pin down the contract the
 * integration sweep relies on:
 *
 *   - Clean inputs produce zero findings.
 *   - The redaction sentinels (`"[redacted]"` / `"[redacted-bfprofile]"`)
 *     are accepted as safe — they are the output of
 *     `scrubEventLogPayload` and MUST NOT be flagged here.
 *   - Every sensitive-key binding produces a tagged finding.
 *   - Plaintext bfprofile and nsec bech32 tokens are flagged wherever
 *     they appear in the value tree (including inside otherwise
 *     innocuous string fields).
 *   - The scanner survives circular references / non-JSON leaves
 *     (functions, symbols, bigints, Error values) without throwing.
 */
import { describe, expect, it } from "vitest";
import {
  scanSnapshot,
  scanSnapshotSet,
  type SecretSweepFinding,
} from "../secretSweepScanner";

function kinds(findings: SecretSweepFinding[]): string[] {
  return findings.map((finding) => finding.kind).sort();
}

describe("scanSnapshot — clean inputs", () => {
  it("returns an empty array for primitives", () => {
    expect(scanSnapshot(null, "null")).toEqual([]);
    expect(scanSnapshot(undefined, "undefined")).toEqual([]);
    expect(scanSnapshot(0, "zero")).toEqual([]);
    expect(scanSnapshot("", "empty-string")).toEqual([]);
    expect(scanSnapshot(true, "bool")).toEqual([]);
  });

  it("returns an empty array for an object with only safe fields", () => {
    const safe = {
      request_id: "req-001",
      op_type: "sign",
      share_public_key: "a".repeat(64),
      group_public_key: "b".repeat(64),
      threshold: 2,
      relays: ["wss://relay.example"],
    };
    expect(scanSnapshot(safe, "safe")).toEqual([]);
  });

  it("treats the redaction sentinels as safe", () => {
    const redacted = {
      share_secret: "[redacted]",
      partial_signature: "[redacted]",
      nonce_secret: "[redacted]",
      passphrase: "[redacted]",
      backup_blob: "[redacted-bfprofile]",
    };
    expect(scanSnapshot(redacted, "redacted")).toEqual([]);
  });

  it("does not match sensitive keys by partial substring", () => {
    // These keys *contain* the substring `secret` / `share` but are
    // legitimate public metadata — they MUST NOT be flagged.
    const publicMetadata = {
      share_public_key: "a".repeat(64),
      group_public_key: "b".repeat(64),
      effective_policy: { respond: { sign: "allow" } },
      peer_pubkey: "c".repeat(64),
    };
    expect(scanSnapshot(publicMetadata, "metadata")).toEqual([]);
  });
});

describe("scanSnapshot — sensitive key detection", () => {
  it("flags partial_signature with a non-sentinel string", () => {
    const findings = scanSnapshot(
      { partial_signature: "0f".repeat(32) },
      "wire",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("partial_signature");
    expect(findings[0].context).toBe("wire.partial_signature");
  });

  it("flags each partial signature entry inside an array", () => {
    const findings = scanSnapshot(
      {
        Sign: {
          partials: [
            { member_idx: 1, partial_signature: "ab".repeat(32) },
            { member_idx: 2, partial_signature: "cd".repeat(32) },
          ],
        },
      },
      "completion",
    );
    expect(findings).toHaveLength(2);
    expect(kinds(findings)).toEqual(["partial_signature", "partial_signature"]);
    expect(findings[0].context).toContain("partial_signature");
  });

  it("flags share_secret / share_secret_hex / seckey", () => {
    const findings = scanSnapshot(
      {
        share_secret: "aa".repeat(32),
        share_secret_hex: "bb".repeat(32),
        nested: { seckey: "cc".repeat(32) },
      },
      "share",
    );
    expect(kinds(findings)).toEqual([
      "share_secret",
      "share_secret",
      "share_secret",
    ]);
  });

  it("flags nonce_secret and nonce_secrets array entries", () => {
    const findings = scanSnapshot(
      {
        nonces: [
          { nonce_secret: "11".repeat(16) },
          { nonce_secret: "22".repeat(16) },
        ],
      },
      "nonces",
    );
    expect(findings).toHaveLength(2);
    expect(kinds(findings)).toEqual(["nonce_secret", "nonce_secret"]);
  });

  it("flags passphrase and password keys", () => {
    const findings = scanSnapshot(
      {
        passphrase: "hunter2password-abcdef",
        login: { password: "another-strong-password-here" },
      },
      "auth",
    );
    expect(kinds(findings)).toEqual(["passphrase", "passphrase"]);
  });
});

describe("scanSnapshot — pattern detection", () => {
  it("flags bech32 nsec1 tokens anywhere in the tree", () => {
    const findings = scanSnapshot(
      {
        log_line: "Unexpected recovered key: nsec1" + "q".repeat(58),
        other_field: "safe",
      },
      "log",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("nsec_bech32");
    expect(findings[0].evidence).toMatch(/^nsec1/);
  });

  it("flags plaintext bfprofile1 tokens anywhere in the tree", () => {
    const findings = scanSnapshot(
      {
        arbitrary: "bfprofile1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4q9xg",
      },
      "input",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("plaintext_bfprofile");
  });

  it("accepts the [redacted-bfprofile] sentinel (it does not match the regex)", () => {
    expect(
      scanSnapshot(
        { blob: "[redacted-bfprofile]", note: "redaction sentinel is safe" },
        "scrubbed",
      ),
    ).toEqual([]);
  });

  it("does not flag encrypted bfprofile values at contract-defined wrapper keys", () => {
    // `encryptedProfilePackage` is by contract the encrypted wrapper
    // persisted to IndexedDB per AGENTS.md ("Never write secrets ... to
    // IndexedDB except inside encrypted bfprofile strings"). It MUST NOT
    // be flagged, even though it starts with the same `bfprofile1`
    // prefix the plaintext form uses.
    expect(
      scanSnapshot(
        {
          profileRecord: {
            id: "profile_abc",
            encryptedProfilePackage:
              "bfprofile1q" + "q".repeat(2000),
            relays: ["wss://relay.example"],
          },
        },
        "idb",
      ),
    ).toEqual([]);
  });

  it("still flags a bfprofile token at any OTHER key", () => {
    // Extra defensive: a bfprofile1 landing in an ad-hoc field is a
    // leak regardless of how it got there. Only the allow-listed keys
    // are exempt.
    const findings = scanSnapshot(
      {
        someOtherBlob: "bfprofile1" + "q".repeat(200),
      },
      "unsafe",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("plaintext_bfprofile");
  });
});

describe("scanSnapshot — resilience", () => {
  it("does not throw on circular references", () => {
    const root: Record<string, unknown> = { name: "cycle" };
    root.self = root;
    expect(() => scanSnapshot(root, "cycle")).not.toThrow();
  });

  it("tolerates non-JSON leaves (functions, bigints, symbols, Error)", () => {
    const payload = {
      fn: () => "hi",
      n: 9007199254740993n,
      sym: Symbol("secret-looking-symbol"),
      err: new Error("boom"),
    };
    expect(() => scanSnapshot(payload, "exotic")).not.toThrow();
    // None of these matches a sensitive key; none of them embeds an
    // nsec1 / bfprofile1 token. Clean snapshot.
    expect(scanSnapshot(payload, "exotic")).toEqual([]);
  });
});

describe("scanSnapshotSet", () => {
  it("returns the union of findings across all snapshots", () => {
    const findings = scanSnapshotSet([
      {
        context: "sessionStorage",
        value: { passphrase: "very-long-password-value" },
      },
      { context: "console", value: [] },
      {
        context: "outbound",
        value: { Sign: { partial_signature: "ab".repeat(32) } },
      },
    ]);
    expect(findings).toHaveLength(2);
    expect(kinds(findings)).toEqual(["partial_signature", "passphrase"]);
    expect(findings.map((f) => f.context).sort()).toEqual([
      "outbound.Sign.partial_signature",
      "sessionStorage.passphrase",
    ]);
  });

  it("returns an empty array when every snapshot is clean", () => {
    const findings = scanSnapshotSet([
      { context: "sessionStorage", value: {} },
      { context: "console", value: [] },
      { context: "idb", value: { encrypted: "[redacted-bfprofile]" } },
    ]);
    expect(findings).toEqual([]);
  });
});
