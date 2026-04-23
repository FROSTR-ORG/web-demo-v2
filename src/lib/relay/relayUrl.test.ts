import { describe, expect, it } from "vitest";

import {
  RELAY_DUPLICATE_ERROR,
  RELAY_INVALID_URL_ERROR,
  RelayValidationError,
  isValidRelayUrl,
  normalizeRelayKey,
  normalizeRelayList,
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

describe("normalizeRelayList", () => {
  it("returns an empty array for an empty input (callers enforce the relay-required gate)", () => {
    expect(normalizeRelayList([])).toEqual([]);
  });

  it("drops non-string / empty / whitespace-only entries without throwing", () => {
    expect(
      normalizeRelayList([
        "wss://relay.example.com",
        "",
        "   ",
        null,
        undefined,
        42,
      ]),
    ).toEqual(["wss://relay.example.com"]);
  });

  it("deduplicates case- and trailing-slash-normalised variants in default (skip) mode", () => {
    expect(
      normalizeRelayList([
        "wss://relay.example.com",
        "WSS://Relay.Example.com/",
        "  wss://relay.example.com/  ",
      ]),
    ).toEqual(["wss://relay.example.com"]);
  });

  it("rejects duplicates with RELAY_DUPLICATE_ERROR when onDuplicate === 'throw'", () => {
    expect(() =>
      normalizeRelayList(
        ["wss://relay.example.com", "wss://Relay.Example.com/"],
        { onDuplicate: "throw" },
      ),
    ).toThrow(RELAY_DUPLICATE_ERROR);
  });

  it("preserves validator-driven throws verbatim on invalid input", () => {
    expect(() =>
      normalizeRelayList(["wss://ok.example.com", "http://bad.example.com"]),
    ).toThrow(RelayValidationError);
    // The canonical copy is the one users see inline.
    expect(() =>
      normalizeRelayList(["http://bad.example.com"]),
    ).toThrow(RELAY_INVALID_URL_ERROR);
  });

  it("honours a custom validator that widens the scheme allow-list (e.g. DEV ws:// opt-in)", () => {
    const allowWsValidator = (url: string) => {
      if (/^ws:\/\//i.test(url)) return url;
      return validateRelayUrl(url);
    };
    expect(
      normalizeRelayList(
        ["ws://127.0.0.1:8194", "wss://relay.example.com"],
        { validator: allowWsValidator },
      ),
    ).toEqual(["ws://127.0.0.1:8194", "wss://relay.example.com"]);
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
