import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SigningBlockedState } from "../DashboardScreen/states/SigningBlockedState";

/**
 * SigningBlockedState — Paper-faithful overlay rendered when the dashboard
 * derives `signing-blocked`.
 *
 * Covers feature m1-signing-blocked-and-nonce-overlay and validation
 * assertions:
 *   - VAL-OPS-012 — Sign blocked state surfaces when no peers are online
 *   - VAL-OPS-018 — Low-nonce-pool edge surfaces a degraded reason
 *   - VAL-OPS-024 — Nonce-pool "Trigger Sync" overlay surfaces during refill
 *   - VAL-DSH-009 — Signing Blocked state (Paper copy)
 */

afterEach(() => {
  cleanup();
});

describe("SigningBlockedState — Paper-faithful CTAs", () => {
  it("renders 'Open Policies' and 'Review Approvals' buttons with Paper copy", () => {
    render(
      <SigningBlockedState
        onStop={() => undefined}
        onOpenPolicies={() => undefined}
        onReviewApprovals={() => undefined}
      />,
    );
    expect(screen.getByText("Open Policies")).toBeInTheDocument();
    expect(screen.getByText("Review Approvals")).toBeInTheDocument();
    expect(screen.getByText("Common Causes")).toBeInTheDocument();
    expect(screen.getByText("Operator Action")).toBeInTheDocument();
  });
});

describe("SigningBlockedState — nonce pool overlay", () => {
  it("does NOT render 'Trigger Sync' when noncePoolDepleted is false", () => {
    render(
      <SigningBlockedState
        onStop={() => undefined}
        onOpenPolicies={() => undefined}
        onReviewApprovals={() => undefined}
        noncePoolDepleted={false}
      />,
    );
    expect(screen.queryByText("Trigger Sync")).not.toBeInTheDocument();
  });

  it("renders 'Trigger Sync' affordance when noncePoolDepleted is true", () => {
    render(
      <SigningBlockedState
        onStop={() => undefined}
        onOpenPolicies={() => undefined}
        onReviewApprovals={() => undefined}
        noncePoolDepleted
        onTriggerSync={() => undefined}
      />,
    );
    const trigger = screen.getByText("Trigger Sync");
    expect(trigger).toBeInTheDocument();
    // Paper copy referencing the nonce pool condition so the user
    // understands why the button is offered.
    const nonceCopyMatches = screen.getAllByText(
      /nonce pool|syncing nonces/i,
    );
    expect(nonceCopyMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("invokes onTriggerSync when the button is clicked (VAL-OPS-024)", () => {
    const handler = vi.fn();
    render(
      <SigningBlockedState
        onStop={() => undefined}
        onOpenPolicies={() => undefined}
        onReviewApprovals={() => undefined}
        noncePoolDepleted
        onTriggerSync={handler}
      />,
    );
    fireEvent.click(screen.getByText("Trigger Sync"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
