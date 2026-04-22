import { describe, it, expect } from "vitest";
import { isValidNsec } from "./validateNsec";

describe("isValidNsec", () => {
  /* Real nsec strings produced by bifrost_bridge_wasm::generate_nsec.
   * Pinned here as checksum-valid fixtures. Do NOT move into a snapshot
   * or regen — these values are reproducible from a burnt-and-forgotten
   * signing key and are only used to exercise the pure bech32 decoder.
   */
  const VALID_NSEC_A =
    "nsec12tfx8l4x0pf3pug57hj2mvek32nr9za6lwwm08u7sqmndxpmrm4s7eetqs";
  const VALID_NSEC_B =
    "nsec1m52qt8wg8fz0rr5h08s5eur84k0xnhnz2vwzekscvhdx2pf02r3sl43fjq";

  it("accepts a real, checksum-valid nsec1 string", () => {
    expect(isValidNsec(VALID_NSEC_A)).toBe(true);
    expect(isValidNsec(VALID_NSEC_B)).toBe(true);
  });

  it("accepts uppercase nsec1 strings (bech32 case-insensitive)", () => {
    expect(isValidNsec(VALID_NSEC_A.toUpperCase())).toBe(true);
  });

  it("rejects structurally malformed nsec1 inputs (nsec1 prefix, bad checksum)", () => {
    // Matches feature acceptance criterion: 'nsec1abc' / 'nsec1invalid' /
    // 'nsec1' followed by non-bech32 garbage must fail structural validation
    // rather than bypass with a naive startsWith check.
    expect(isValidNsec("nsec1")).toBe(false);
    expect(isValidNsec("nsec1abc")).toBe(false);
    expect(isValidNsec("nsec1invalid")).toBe(false);
    expect(isValidNsec("nsec1aaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    // Correct length but invalid checksum (flip last char).
    expect(
      isValidNsec(
        "nsec12tfx8l4x0pf3pug57hj2mvek32nr9za6lwwm08u7sqmndxpmrm4s7eetqa",
      ),
    ).toBe(false);
  });

  it("rejects inputs not starting with nsec1", () => {
    expect(isValidNsec("npub1abcdef")).toBe(false);
    expect(isValidNsec("not-a-valid-key")).toBe(false);
    expect(isValidNsec("")).toBe(false);
    expect(isValidNsec("   ")).toBe(false);
  });

  it("rejects mixed-case bech32 (BIP-173 forbids mixed case)", () => {
    expect(
      isValidNsec(
        "nsec12tfx8l4x0pf3pug57hj2mvek32nr9za6lwwm08u7sqmndxpmrm4s7eetqS",
      ),
    ).toBe(false);
  });

  it("rejects bech32 with out-of-charset characters (b, i, o)", () => {
    // Replace a valid char with 'b' (not in bech32 charset)
    expect(
      isValidNsec(
        "nsec1btfx8l4x0pf3pug57hj2mvek32nr9za6lwwm08u7sqmndxpmrm4s7eetqs",
      ),
    ).toBe(false);
  });

  it("accepts the raw trimmed input only (does not internally trim)", () => {
    // Higher-level callers must trim before calling. Whitespace in-band
    // is not a legal bech32 char and must fail.
    expect(isValidNsec(` ${VALID_NSEC_A} `)).toBe(false);
  });
});
