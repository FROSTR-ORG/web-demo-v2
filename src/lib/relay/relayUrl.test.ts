import { describe, expect, it } from "vitest";

import {
  RELAY_DUPLICATE_ERROR,
  RELAY_INVALID_URL_ERROR,
  RelayValidationError,
  isValidRelayUrl,
  normalizeRelayKey,
  validateRelayUrl,
} from "./relayUrl";

/**
 * Covers the URL-validation and duplicate-detection contract for the
 * m5-relay-list-persist feature (VAL-SETTINGS-004 / VAL-SETTINGS-023).
 */

describe("validateRelayUrl", () => {
  it("accepts canonical wss:// URLs verbatim (no rewrite)", () => {
    expect(validateRelayUrl("wss://relay.damus.io")).toBe(
      "wss://relay.damus.io",
    );
    expect(validateRelayUrl("wss://relay.example.com/path?x=1")).toBe(
      "wss://relay.example.com/path?x=1",
    );
  });

  it("trims leading and trailing whitespace before validation", () => {
    expect(validateRelayUrl("  wss://relay.primal.net  ")).toBe(
      "wss://relay.primal.net",
    );
  });

  it("rejects bare hostnames with the canonical error message (VAL-SETTINGS-004)", () => {
    expect(() => validateRelayUrl("relay.example.com")).toThrow(
      RelayValidationError,
    );
    expect(() => validateRelayUrl("relay.example.com")).toThrow(
      RELAY_INVALID_URL_ERROR,
    );
  });

  it("rejects non-wss schemes (VAL-SETTINGS-004)", () => {
    for (const bad of [
      "http://relay.example.com",
      "https://relay.example.com",
      "ws://relay.example.com",
      "ftp://relay.example.com",
    ]) {
      expect(() => validateRelayUrl(bad)).toThrow(RelayValidationError);
    }
  });

  it("rejects malformed inputs (VAL-SETTINGS-004)", () => {
    for (const bad of ["", "   ", "wss://", "not a url", "wss:// relay.test"]) {
      expect(() => validateRelayUrl(bad)).toThrow(RelayValidationError);
    }
  });

  it("isValidRelayUrl mirrors validateRelayUrl without throwing", () => {
    expect(isValidRelayUrl("wss://relay.damus.io")).toBe(true);
    expect(isValidRelayUrl("http://relay.example.com")).toBe(false);
    expect(isValidRelayUrl("wss://")).toBe(false);
  });
});

describe("normalizeRelayKey (VAL-SETTINGS-023)", () => {
  it("collapses case-only variants to the same key", () => {
    expect(normalizeRelayKey("wss://Relay.Example.com")).toBe(
      normalizeRelayKey("WSS://relay.example.com"),
    );
  });

  it("collapses single trailing slash variants to the same key", () => {
    expect(normalizeRelayKey("wss://relay.example.com")).toBe(
      normalizeRelayKey("wss://relay.example.com/"),
    );
  });

  it("preserves non-trivial path components for de-dup parity", () => {
    expect(normalizeRelayKey("wss://relay.example.com/foo")).not.toBe(
      normalizeRelayKey("wss://relay.example.com"),
    );
    // trailing slash on a deeper path is still stripped
    expect(normalizeRelayKey("wss://relay.example.com/foo/")).toBe(
      normalizeRelayKey("wss://relay.example.com/foo"),
    );
  });

  it("returns an empty string for empty / whitespace input", () => {
    expect(normalizeRelayKey("")).toBe("");
    expect(normalizeRelayKey("   ")).toBe("");
  });

  it("falls back to a trimmed lowercased key for malformed input", () => {
    // not a real URL — still useful for live-typing de-dup
    expect(normalizeRelayKey("  WSS://Foo  ")).toBe(
      normalizeRelayKey("wss://foo"),
    );
  });
});

describe("error message exports", () => {
  it("RELAY_INVALID_URL_ERROR is the canonical UI string", () => {
    expect(RELAY_INVALID_URL_ERROR).toBe("Relay URL must start with wss://");
  });

  it("RELAY_DUPLICATE_ERROR is the canonical UI string", () => {
    expect(RELAY_DUPLICATE_ERROR).toBe("Relay already configured");
  });
});
