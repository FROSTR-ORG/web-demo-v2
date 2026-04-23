import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationFailure } from "../../../../lib/bifrost/types";
import { SigningFailedModal } from "../SigningFailedModal";

/**
 * Tests for feature
 * `fix-m1-signing-failed-modal-peer-response-and-retry-correlation`.
 *
 * Fulfils VAL-OPS-006 (strict):
 *  - The modal MUST always render a "Peer responses" line.
 *  - When the runtime payload does NOT expose a
 *    `peers_responded` / `total_peers` pair (the current contract for
 *    `OperationFailure` — see `docs/runtime-deviations-from-paper.md`), the
 *    modal renders the neutral fallback "Peer responses: not reported by
 *    runtime" — NOT a hard-coded placeholder like "1/2".
 *  - When such a pair IS present (either via the `OperationFailure`
 *    enrichment path or a future runtime extension) the modal renders
 *    "Peer responses: <N> of <M>" verbatim.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SigningFailedModal — peer-response line (VAL-OPS-006 strict)", () => {
  it("renders the neutral fallback 'Peer responses: not reported by runtime' when the OperationFailure has no peer-response metadata", () => {
    const failure: OperationFailure = {
      request_id: "req-pr-1",
      op_type: "sign",
      code: "timeout",
      message: "timeout waiting for peers",
      failed_peer: null,
    };
    render(
      <SigningFailedModal
        failure={failure}
        messageHex={"a".repeat(64)}
        onClose={() => undefined}
      />,
    );
    const codeText = screen.getByTestId("signing-failed-code-text");
    // Always-labelled fallback line — present even when the runtime does
    // not expose a peer-response ratio. Must NOT be a hard-coded ratio.
    expect(codeText.textContent).toContain(
      "Peer responses: not reported by runtime",
    );
    expect(codeText.textContent).not.toContain("1/2");
    expect(codeText.textContent).not.toContain("0/2");
    expect(codeText.textContent).not.toContain("Peers responded");
    expect(codeText.textContent).not.toContain("no peers responded");
  });

  it("renders 'Peer responses: not reported by runtime' even when no failure payload is supplied (neutral fallback still labelled)", () => {
    render(<SigningFailedModal onClose={() => undefined} />);
    const codeText = screen.getByTestId("signing-failed-code-text");
    expect(codeText.textContent).toContain(
      "Peer responses: not reported by runtime",
    );
    expect(codeText.textContent).not.toContain("1/2");
    expect(codeText.textContent).not.toContain("Peers responded");
  });

  it("renders 'Peer responses: N of M' when the enriched failure carries peers_responded/total_peers", () => {
    // The feature contract allows future runtime versions to emit a real
    // peer-response ratio as a structured field. The modal must surface it
    // verbatim instead of the neutral fallback when present.
    const failure = {
      request_id: "req-pr-2",
      op_type: "sign" as const,
      code: "timeout" as const,
      message: "timeout",
      failed_peer: null,
      peers_responded: 1,
      total_peers: 2,
    } as OperationFailure & {
      peers_responded?: number;
      total_peers?: number;
    };
    render(
      <SigningFailedModal
        failure={failure as OperationFailure}
        messageHex={"a".repeat(64)}
        onClose={() => undefined}
      />,
    );
    const codeText = screen.getByTestId("signing-failed-code-text");
    expect(codeText.textContent).toContain("Peer responses: 1 of 2");
    expect(codeText.textContent).not.toContain("not reported by runtime");
  });
});
