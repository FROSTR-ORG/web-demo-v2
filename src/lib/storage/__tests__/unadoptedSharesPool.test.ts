/**
 * fix-m7-onboard-distinct-share-allocation — unit coverage for the
 * encrypted unadopted-shares pool primitives. Runs under vitest's
 * `happy-dom` environment which polyfills `crypto.subtle` via Node's
 * WebCrypto implementation, so these tests exercise the real AES-GCM
 * + PBKDF2 path end-to-end.
 */

import { describe, expect, it } from "vitest";
import {
  UNADOPTED_POOL_EXHAUSTED_ERROR,
  UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR,
  UNADOPTED_POOL_VERSION,
  UNADOPTED_POOL_WRONG_PASSWORD_ERROR,
  availableUnadoptedShares,
  decryptUnadoptedSharesPool,
  encryptUnadoptedSharesPool,
  updateShareAllocationStatus,
  upsertShareAllocation,
  type ShareAllocationEntry,
  type UnadoptedSharesPool,
} from "../unadoptedSharesPool";

const PUBKEY_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PUBKEY_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET_1 = "1".repeat(64);
const SECRET_2 = "2".repeat(64);

function samplePool(): UnadoptedSharesPool {
  return {
    version: UNADOPTED_POOL_VERSION,
    shares: [
      { idx: 1, share_secret: SECRET_1, member_pubkey_x_only: PUBKEY_A },
      { idx: 2, share_secret: SECRET_2, member_pubkey_x_only: PUBKEY_B },
    ],
  };
}

describe("encryptUnadoptedSharesPool / decryptUnadoptedSharesPool", () => {
  it("round-trips a pool under the correct password", async () => {
    const pool = samplePool();
    const envelope = await encryptUnadoptedSharesPool(pool, "profile-password");
    expect(typeof envelope).toBe("string");
    // Envelope is JSON.
    const parsed = JSON.parse(envelope);
    expect(parsed.v).toBe(UNADOPTED_POOL_VERSION);
    expect(parsed.kdf).toBe("PBKDF2-SHA256");
    expect(typeof parsed.salt).toBe("string");
    expect(typeof parsed.iv).toBe("string");
    expect(typeof parsed.ct).toBe("string");
    // Share secrets must not appear in the encrypted envelope.
    expect(envelope).not.toContain(SECRET_1);
    expect(envelope).not.toContain(SECRET_2);

    const decrypted = await decryptUnadoptedSharesPool(
      envelope,
      "profile-password",
    );
    expect(decrypted.version).toBe(UNADOPTED_POOL_VERSION);
    expect(decrypted.shares).toHaveLength(2);
    expect(decrypted.shares[0].share_secret).toBe(SECRET_1);
    expect(decrypted.shares[1].share_secret).toBe(SECRET_2);
  });

  it("produces distinct ciphertexts on successive encrypts of the same pool", async () => {
    const pool = samplePool();
    const a = await encryptUnadoptedSharesPool(pool, "profile-password");
    const b = await encryptUnadoptedSharesPool(pool, "profile-password");
    expect(a).not.toBe(b);
  });

  it("rejects wrong password with the canonical error copy", async () => {
    const pool = samplePool();
    const envelope = await encryptUnadoptedSharesPool(pool, "profile-password");
    await expect(
      decryptUnadoptedSharesPool(envelope, "wrong-password"),
    ).rejects.toThrow(UNADOPTED_POOL_WRONG_PASSWORD_ERROR);
  });

  it("rejects malformed envelope with the canonical error copy", async () => {
    await expect(
      decryptUnadoptedSharesPool("not-json", "profile-password"),
    ).rejects.toThrow(UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR);
    await expect(
      decryptUnadoptedSharesPool(
        JSON.stringify({ v: 99, kdf: "unknown" }),
        "profile-password",
      ),
    ).rejects.toThrow(UNADOPTED_POOL_MALFORMED_ENVELOPE_ERROR);
  });
});

describe("availableUnadoptedShares", () => {
  it("returns every share when the ledger is empty", () => {
    const pool = samplePool();
    expect(availableUnadoptedShares(pool, [])).toHaveLength(2);
  });

  it("filters out shares with awaiting_adoption or completed entries", () => {
    const pool = samplePool();
    const ledger: ShareAllocationEntry[] = [
      {
        share_idx: 1,
        request_id: "req-awaiting",
        device_label: "Alpha",
        allocated_at: 1,
        status: "awaiting_adoption",
      },
      {
        share_idx: 2,
        request_id: "req-completed",
        device_label: "Beta",
        allocated_at: 2,
        terminal_at: 3,
        status: "completed",
      },
    ];
    expect(availableUnadoptedShares(pool, ledger)).toHaveLength(0);
  });

  it("returns shares whose most recent ledger entry is failed or cancelled", () => {
    const pool = samplePool();
    const ledger: ShareAllocationEntry[] = [
      {
        share_idx: 1,
        request_id: "req-failed",
        device_label: "Alpha",
        allocated_at: 1,
        terminal_at: 2,
        status: "failed",
      },
      {
        share_idx: 2,
        request_id: "req-cancelled",
        device_label: "Beta",
        allocated_at: 3,
        terminal_at: 4,
        status: "cancelled",
      },
    ];
    const available = availableUnadoptedShares(pool, ledger);
    expect(available.map((s) => s.idx).sort()).toEqual([1, 2]);
  });
});

describe("upsertShareAllocation / updateShareAllocationStatus", () => {
  it("upsert replaces an existing entry by request_id", () => {
    const base: ShareAllocationEntry = {
      share_idx: 1,
      request_id: "req-1",
      device_label: "Alpha",
      allocated_at: 10,
      status: "awaiting_adoption",
    };
    const [first] = [base];
    const next = upsertShareAllocation([first], {
      ...base,
      status: "failed",
      terminal_at: 20,
      failure_reason: "timeout",
    });
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("failed");
    expect(next[0].failure_reason).toBe("timeout");
  });

  it("updateShareAllocationStatus transitions by request_id and stamps terminal_at", () => {
    const ledger: ShareAllocationEntry[] = [
      {
        share_idx: 1,
        request_id: "req-1",
        device_label: "Alpha",
        allocated_at: 10,
        status: "awaiting_adoption",
      },
    ];
    const next = updateShareAllocationStatus(ledger, "req-1", "completed");
    expect(next[0].status).toBe("completed");
    expect(typeof next[0].terminal_at).toBe("number");
  });

  it("updateShareAllocationStatus returns the same reference when no match", () => {
    const ledger: ShareAllocationEntry[] = [
      {
        share_idx: 1,
        request_id: "req-1",
        device_label: "Alpha",
        allocated_at: 10,
        status: "awaiting_adoption",
      },
    ];
    const next = updateShareAllocationStatus(ledger, "no-such", "failed");
    expect(next).toBe(ledger);
  });
});

describe("pool exhaustion canonical error constant", () => {
  it("matches the copy surfaced to the user", () => {
    expect(UNADOPTED_POOL_EXHAUSTED_ERROR).toBe("No remaining share slots.");
  });
});
