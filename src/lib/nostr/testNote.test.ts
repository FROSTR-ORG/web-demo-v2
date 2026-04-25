import { describe, expect, it } from "vitest";
import {
  buildTextNoteForSigning,
  buildUnsignedTextNote,
  encodeMinimalNevent,
  finalizeTextNoteEvent,
  serializeNostrEventForId,
} from "./testNote";

describe("test note Nostr event helpers", () => {
  it("serializes kind 1 notes using the canonical NIP-01 event-id shape", () => {
    const pubkey = "f".repeat(64);
    const event = buildUnsignedTextNote({
      pubkey,
      content: "hello world",
      createdAt: 1,
    });

    expect(serializeNostrEventForId(event)).toBe(
      `[0,"${pubkey}",1,1,[],"hello world"]`,
    );
  });

  it("computes a deterministic event id for a fixed text note", async () => {
    await expect(
      buildTextNoteForSigning({
        pubkey: "f".repeat(64),
        content: "hello world",
        createdAt: 1,
      }),
    ).resolves.toMatchObject({
      id: "b5dfc5afb70e5d1b855cbb240ad4fee8f52e90d71bd40beeaf632e1f627ad575",
    });
  });

  it("finalizes the signed event with the threshold signature", async () => {
    const event = await buildTextNoteForSigning({
      pubkey: "a".repeat(64),
      content: "hello world",
      createdAt: 2,
    });
    const signed = finalizeTextNoteEvent(event, "b".repeat(128));

    expect(signed).toMatchObject({
      id: event.id,
      pubkey: "a".repeat(64),
      created_at: 2,
      kind: 1,
      tags: [],
      content: "hello world",
      sig: "b".repeat(128),
    });
  });

  it("rejects non-hex group public keys before signing", async () => {
    await expect(
      buildTextNoteForSigning({
        pubkey: "npub1not-xonly",
        content: "hello world",
        createdAt: 1,
      }),
    ).rejects.toThrow(/64-character hex group public key/i);
  });

  it("encodes a minimal nevent for a raw event id", () => {
    expect(
      encodeMinimalNevent(
        "617d66f314246f54eb2b9c29cff7bfd61c2c97b9a5bdbb8d1923416a236ef48c",
      ),
    ).toBe(
      "nevent1qqsxzltx7v2zgm65av4ec2w077lav8pvj7u6t0dm35vjxst2ydh0frq6f2cfz",
    );
  });

  it("adds relay hints to nevent TLV payloads when relays are provided", () => {
    const eventId =
      "617d66f314246f54eb2b9c29cff7bfd61c2c97b9a5bdbb8d1923416a236ef48c";
    const minimal = encodeMinimalNevent(eventId);
    const hinted = encodeMinimalNevent(eventId, ["wss://relay.example.com"]);

    expect(hinted).toMatch(/^nevent1/);
    expect(hinted).not.toBe(minimal);
  });

  it("rejects relay hints that exceed a single TLV length byte", () => {
    expect(() =>
      encodeMinimalNevent("617d66f314246f54eb2b9c29cff7bfd61c2c97b9a5bdbb8d1923416a236ef48c", [
        `wss://${"r".repeat(256)}`,
      ]),
    ).toThrow(/255-byte TLV limit/i);
  });
});
