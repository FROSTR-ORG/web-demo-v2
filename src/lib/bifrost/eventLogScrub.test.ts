/**
 * Tests for {@link scrubEventLogPayload} — a deep redactor applied to
 * the RuntimeEventLog entry payloads before they are handed to the
 * Event Log panel for JSON rendering.
 *
 * Fulfills VAL-EVENTLOG-019 and the m4-event-log-panel feature clause:
 * "Payloads must not contain secrets (scrub partial_signature,
 * share_secret, nonce_secret, passphrase, plaintext bfprofile)".
 */
import { describe, expect, it } from "vitest";
import { scrubEventLogPayload } from "./eventLogScrub";

describe("scrubEventLogPayload", () => {
  it("returns primitives unchanged", () => {
    expect(scrubEventLogPayload(null)).toBeNull();
    expect(scrubEventLogPayload(undefined)).toBeUndefined();
    expect(scrubEventLogPayload(0)).toBe(0);
    expect(scrubEventLogPayload("")).toBe("");
    expect(scrubEventLogPayload(true)).toBe(true);
    expect(scrubEventLogPayload("just-an-id")).toBe("just-an-id");
  });

  it("redacts top-level sensitive keys", () => {
    const input = {
      request_id: "req-1",
      partial_signature: "DEADBEEF".repeat(8),
      share_secret: "0123456789abcdef".repeat(4),
      nonce_secret: "aaaa".repeat(16),
      passphrase: "hunter2",
    };
    const out = scrubEventLogPayload(input) as Record<string, unknown>;
    expect(out.request_id).toBe("req-1");
    expect(out.partial_signature).toBe("[redacted]");
    expect(out.share_secret).toBe("[redacted]");
    expect(out.nonce_secret).toBe("[redacted]");
    expect(out.passphrase).toBe("[redacted]");
  });

  it("redacts sensitive keys under nested objects and arrays", () => {
    const input = {
      Sign: {
        request_id: "req-sign-1",
        partials: [
          { member_idx: 0, partial_signature: "0f".repeat(32) },
          { member_idx: 1, partial_signature: "ae".repeat(32) },
        ],
      },
      session: {
        nonces: [
          { nonce_secret: "11".repeat(16) },
          { nonce_secret: "22".repeat(16) },
        ],
      },
    };
    const out = scrubEventLogPayload(input) as {
      Sign: { partials: Array<Record<string, unknown>> };
      session: { nonces: Array<Record<string, unknown>> };
    };
    expect(out.Sign.partials[0].partial_signature).toBe("[redacted]");
    expect(out.Sign.partials[1].partial_signature).toBe("[redacted]");
    expect(out.Sign.partials[0].member_idx).toBe(0);
    expect(out.session.nonces[0].nonce_secret).toBe("[redacted]");
    expect(out.session.nonces[1].nonce_secret).toBe("[redacted]");
  });

  it("redacts plaintext bfprofile strings regardless of key", () => {
    // bech32 charset excludes `b`, `i`, `o`, `1` — use valid chars.
    const input = {
      arbitrary_field:
        "bfprofile1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4q9xgclkz4f5e0r8p2d7y6m3n0",
      nested: {
        raw:
          "prefix bfprofile1qacdefgh0123456789zz more context bfprofile1qxyz987uvw should be fully replaced",
      },
    };
    const out = scrubEventLogPayload(input) as {
      arbitrary_field: string;
      nested: { raw: string };
    };
    // A single token becomes exactly "[redacted-bfprofile]".
    expect(out.arbitrary_field).toBe("[redacted-bfprofile]");
    // Embedded occurrences are replaced in-place, other text preserved.
    expect(out.nested.raw).not.toContain("bfprofile1q");
    expect(out.nested.raw).toContain("prefix ");
    expect(out.nested.raw).toContain("more context ");
    // Replaced with the redaction sentinel.
    expect(
      (out.nested.raw.match(/\[redacted-bfprofile\]/g) ?? []).length,
    ).toBe(2);
  });

  it("does not mutate the input object", () => {
    const input = {
      share_secret: "sensitive-value",
      nested: { passphrase: "hunter2" },
    };
    scrubEventLogPayload(input);
    expect(input.share_secret).toBe("sensitive-value");
    expect(input.nested.passphrase).toBe("hunter2");
  });

  it("leaves non-sensitive payload shapes untouched", () => {
    const failure = {
      request_id: "req-fail-1",
      op_type: "sign",
      code: "timeout",
      message: "peer offline",
      failed_peer: null,
    };
    expect(scrubEventLogPayload(failure)).toEqual(failure);
  });
});
