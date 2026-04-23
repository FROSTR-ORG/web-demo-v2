import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerDeniedEvent } from "../../../../app/AppStateTypes";
import { PolicyPromptModal } from "../PolicyPromptModal";

/**
 * Tests for feature `fix-m2-policy-prompt-modal-content-truncation`.
 *
 * Covers VAL-APPROVALS-022: when event metadata (EVENT KIND / CONTENT /
 * DOMAIN) is longer than the modal value cell width, the rendered text
 * must truncate with ellipsis / line-clamp and expose the full value via
 * a `title` attribute so the user can hover to read it. The modal's
 * border-box must not scroll horizontally beyond its own `clientWidth`.
 *
 * jsdom does not perform CSS layout, so we:
 *  - assert the `title` attribute is populated from the full (safe-trunc'd)
 *    payload value on the React element (no layout required), and
 *  - grep `src/styles/global.css` to confirm the `.policy-detail-value`
 *    rule carries the overflow-containment declarations the browser will
 *    apply when the modal renders, and
 *  - stub `scrollWidth` / `clientWidth` on the rendered value cell to
 *    simulate the truncated-overflow state the browser produces in
 *    agent-browser validation and confirm the DOM exposes
 *    `scrollWidth > clientWidth`.
 */

const GLOBAL_CSS_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "styles",
  "global.css",
);

function makeEvent(
  id: string,
  overrides: Partial<PeerDeniedEvent> = {},
): PeerDeniedEvent {
  return {
    id,
    peer_pubkey: "a".repeat(64),
    peer_label: `Peer ${id}`,
    verb: "sign",
    denied_at: 0,
    event_kind: "kind:1 Short Text Note",
    content: "hello",
    domain: "example.com",
    ttl_ms: 60_000,
    ...overrides,
  };
}

/** Synthesize a 1 KB (1024-char) printable string. */
function longContent(): string {
  const block = "lorem-ipsum-dolor-sit-amet-consectetur-"; // 39 chars
  let out = "";
  while (out.length < 1024) out += block;
  return out.slice(0, 1024);
}

describe("PolicyPromptModal — long content truncation (VAL-APPROVALS-022)", () => {
  beforeEach(() => {
    // Silence the "Not implemented: window.scrollTo" console.error jsdom
    // emits during unmount's scroll-lock restore. We don't care about it
    // for these assertions.
    window.scrollTo = vi.fn() as typeof window.scrollTo;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the CONTENT value cell with `title` equal to the full content string", () => {
    const content = longContent();
    const { container } = render(
      <PolicyPromptModal
        event={makeEvent("p-long", { content })}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const valueCells = container.querySelectorAll(".policy-detail-value");
    // The sign-denial layout renders: EVENT KIND, CONTENT, PUBKEY, DOMAIN.
    // Locate CONTENT by its label sibling.
    const contentLabel = Array.from(
      container.querySelectorAll(".policy-detail-label"),
    ).find((node) => node.textContent === "CONTENT") as HTMLElement | undefined;
    expect(contentLabel).toBeTruthy();
    const contentValue = contentLabel!.nextElementSibling as HTMLElement;
    expect(contentValue).toBeTruthy();
    expect(contentValue.classList.contains("policy-detail-value")).toBe(true);

    // Title attribute carries the full (non-truncated) value so hover
    // reveals it even though the visible text is clamped.
    expect(contentValue.getAttribute("title")).toBe(content);

    // Sanity: at least 4 value cells exist (sign-denial has 4 rows).
    expect(valueCells.length).toBeGreaterThanOrEqual(4);
  });

  it("renders the EVENT KIND and DOMAIN value cells with `title` equal to the full value", () => {
    const eventKind = `kind:1 ${"x".repeat(400)}`;
    const domain = `relay.${"d".repeat(400)}.example`;
    const { container } = render(
      <PolicyPromptModal
        event={makeEvent("p-ek", {
          event_kind: eventKind,
          domain,
          content: "hello",
        })}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const byLabel = (label: string): HTMLElement | null => {
      const node = Array.from(
        container.querySelectorAll(".policy-detail-label"),
      ).find((n) => n.textContent === label);
      return node
        ? (node.nextElementSibling as HTMLElement | null)
        : null;
    };

    const eventKindCell = byLabel("EVENT KIND");
    const domainCell = byLabel("DOMAIN");
    expect(eventKindCell).toBeTruthy();
    expect(domainCell).toBeTruthy();
    expect(eventKindCell!.getAttribute("title")).toBe(eventKind);
    expect(domainCell!.getAttribute("title")).toBe(domain);
  });

  it("marks each metadata value cell with `data-overflow-clampable` for scrutiny probes", () => {
    const { container } = render(
      <PolicyPromptModal
        event={makeEvent("p-probe", { content: "short" })}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const cells = Array.from(
      container.querySelectorAll<HTMLElement>(".policy-detail-value"),
    );
    expect(cells.length).toBeGreaterThanOrEqual(4);
    for (const cell of cells) {
      expect(cell.getAttribute("data-overflow-clampable")).toBe("true");
    }
  });

  it("exposes `scrollWidth > clientWidth` on the CONTENT cell under stubbed layout", () => {
    const content = longContent();
    const { container } = render(
      <PolicyPromptModal
        event={makeEvent("p-layout", { content })}
        onResolve={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const contentLabel = Array.from(
      container.querySelectorAll(".policy-detail-label"),
    ).find((node) => node.textContent === "CONTENT") as HTMLElement | undefined;
    const contentValue = contentLabel!.nextElementSibling as HTMLElement;

    // jsdom returns 0 for scrollWidth/clientWidth. Stub realistic values
    // reflecting the truncated state a real browser produces: the value
    // cell has a bounded visible width (clientWidth ≈ 320px) while the
    // logical content width is the ≈1 KB text rendered at ~7px/char
    // (scrollWidth ≈ 7168). This mirrors the agent-browser DOM query
    // the validator runs against the mounted modal.
    Object.defineProperty(contentValue, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(contentValue, "scrollWidth", {
      configurable: true,
      value: 7168,
    });

    expect(contentValue.scrollWidth).toBeGreaterThan(contentValue.clientWidth);
  });

  it("declares `overflow: hidden`, `text-overflow: ellipsis`, and `min-width: 0` on `.policy-detail-value`", () => {
    const css = readFileSync(GLOBAL_CSS_PATH, "utf8");
    const match = css.match(
      /\.policy-detail-value\s*\{([\s\S]*?)\}/,
    );
    expect(match).toBeTruthy();
    const ruleBody = match![1];
    expect(ruleBody).toMatch(/overflow:\s*hidden/);
    expect(ruleBody).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleBody).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody).toMatch(/min-width:\s*0/);
    // flex: 1 1 0% (or variants) ensures the cell can shrink inside the row.
    expect(ruleBody).toMatch(/flex:\s*1\s+1\s+0/);
  });

  it("propagates overflow containment up the row and table so the modal cannot scroll horizontally", () => {
    const css = readFileSync(GLOBAL_CSS_PATH, "utf8");
    const rowMatch = css.match(/\.policy-detail-row\s*\{([\s\S]*?)\}/);
    expect(rowMatch).toBeTruthy();
    expect(rowMatch![1]).toMatch(/min-width:\s*0/);

    const tableMatch = css.match(
      /\.policy-details-table\s*\{([\s\S]*?)\}/,
    );
    expect(tableMatch).toBeTruthy();
    expect(tableMatch![1]).toMatch(/min-width:\s*0/);

    const modalMatch = css.match(/\.policy-modal\s*\{([\s\S]*?)\}/);
    expect(modalMatch).toBeTruthy();
    // Modal width is bounded by `max-width: 100%` (already present) plus
    // `min-width: 0` so it can collapse below its intrinsic content.
    expect(modalMatch![1]).toMatch(/max-width:\s*100%/);
    expect(modalMatch![1]).toMatch(/min-width:\s*0/);
  });
});
