import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NonSignFailureBannerStack,
  type NonSignFailureBannerEntry,
} from "../NonSignFailureBanner";

/**
 * Unit tests for the aria-live non-sign failure banner surface created
 * under `fix-m1-non-sign-failure-surface`. The stack is the non-modal
 * feedback target required by VAL-OPS-015 for ecdh / ping / onboard
 * failures that have no resolvable PeerRow to attach to.
 */

afterEach(() => {
  cleanup();
});

function buildBanner(
  overrides: Partial<NonSignFailureBannerEntry> &
    Pick<NonSignFailureBannerEntry, "id" | "op_type">,
): NonSignFailureBannerEntry {
  return {
    id: overrides.id,
    op_type: overrides.op_type,
    code: overrides.code ?? "timeout",
    message: overrides.message ?? "failure message",
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

describe("NonSignFailureBannerStack", () => {
  it("renders an aria-live polite region even when no banners are present", () => {
    render(
      <NonSignFailureBannerStack banners={[]} onDismiss={() => undefined} />,
    );
    const stack = screen.getByTestId("non-sign-failure-banners");
    expect(stack).toBeInTheDocument();
    expect(stack.getAttribute("aria-live")).toBe("polite");
    expect(stack.getAttribute("role")).toBe("status");
  });

  it("renders a banner per entry including op_type, message, and code", () => {
    const banners: NonSignFailureBannerEntry[] = [
      buildBanner({ id: "b1", op_type: "ecdh", message: "ecdh timed out" }),
      buildBanner({
        id: "b2",
        op_type: "ping",
        code: "peer_rejected",
        message: "peer rejected",
      }),
      buildBanner({ id: "b3", op_type: "onboard", message: "onboard failed" }),
    ];
    render(
      <NonSignFailureBannerStack
        banners={banners}
        onDismiss={() => undefined}
      />,
    );
    const b1 = screen.getByTestId("non-sign-failure-banner-b1");
    expect(b1.getAttribute("data-op-type")).toBe("ecdh");
    expect(b1.textContent).toContain("ecdh timed out");
    expect(b1.textContent).toContain("timeout");

    const b2 = screen.getByTestId("non-sign-failure-banner-b2");
    expect(b2.getAttribute("data-op-type")).toBe("ping");
    expect(b2.textContent).toContain("peer rejected");
    expect(b2.textContent).toContain("peer_rejected");

    const b3 = screen.getByTestId("non-sign-failure-banner-b3");
    expect(b3.getAttribute("data-op-type")).toBe("onboard");
    expect(b3.textContent).toContain("onboard failed");
  });

  it("invokes onDismiss with the banner id when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    const banners: NonSignFailureBannerEntry[] = [
      buildBanner({ id: "xyz", op_type: "ecdh" }),
    ];
    render(
      <NonSignFailureBannerStack banners={banners} onDismiss={onDismiss} />,
    );
    fireEvent.click(
      screen.getByTestId("non-sign-failure-banner-dismiss-xyz"),
    );
    expect(onDismiss).toHaveBeenCalledWith("xyz");
  });

  it("dismiss button exposes an accessible label per op_type", () => {
    const banners: NonSignFailureBannerEntry[] = [
      buildBanner({ id: "d1", op_type: "ping" }),
    ];
    render(
      <NonSignFailureBannerStack banners={banners} onDismiss={() => undefined} />,
    );
    const dismiss = screen.getByTestId("non-sign-failure-banner-dismiss-d1");
    expect(dismiss.getAttribute("aria-label")).toBe(
      "Dismiss ping failure notice",
    );
  });
});
