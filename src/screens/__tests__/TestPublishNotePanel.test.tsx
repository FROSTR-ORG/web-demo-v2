import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockPublishTestNote = vi.fn(async () => ({
  requestId: "req-note-1",
  eventId: "1".repeat(64),
  nevent: "nevent1mock",
  event: {
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "hello world",
    sig: "3".repeat(128),
  },
  reached: ["wss://relay.primal.net"],
  failed: [],
}));

const mockAppState = {
  publishTestNote: mockPublishTestNote,
  runtimeRelays: [{ url: "wss://relay.primal.net", state: "online" }],
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => mockAppState,
}));

import { TestPublishNotePanel } from "../DashboardScreen/panels/TestPublishNotePanel";

afterEach(() => {
  cleanup();
  mockPublishTestNote.mockClear();
  mockAppState.runtimeRelays = [
    { url: "wss://relay.primal.net", state: "online" },
  ];
});

describe("TestPublishNotePanel", () => {
  it("renders with hello world as the default note content", () => {
    render(<TestPublishNotePanel signingBlocked={false} />);

    expect(screen.getByTestId("test-publish-note-panel")).toBeInTheDocument();
    expect(screen.getByLabelText(/note content/i)).toHaveValue("hello world");
  });

  it("publishes the current note content and displays request, event, and relay status", async () => {
    render(<TestPublishNotePanel signingBlocked={false} />);

    fireEvent.click(screen.getByRole("button", { name: /publish note/i }));

    await waitFor(() =>
      expect(mockPublishTestNote).toHaveBeenCalledWith({
        content: "hello world",
      }),
    );
    expect(screen.getByTestId("test-publish-note-request-id")).toHaveTextContent(
      "req-note-1",
    );
    expect(screen.getByTestId("test-publish-note-event-id")).toHaveTextContent(
      "1".repeat(64),
    );
    expect(screen.getByTestId("test-publish-note-nevent")).toHaveTextContent(
      "nevent1mock",
    );
    expect(screen.getByTestId("test-publish-note-relays")).toHaveTextContent(
      "Published to 1 relay",
    );
  });

  it("disables publish while signing is blocked", () => {
    render(<TestPublishNotePanel signingBlocked={true} />);

    expect(screen.getByRole("button", { name: /publish note/i })).toBeDisabled();
  });

  it("disables publish when known relays are all offline", () => {
    mockAppState.runtimeRelays = [
      { url: "wss://relay.primal.net", state: "offline" },
    ];
    render(<TestPublishNotePanel signingBlocked={false} />);

    expect(screen.getByRole("button", { name: /publish note/i })).toBeDisabled();
    expect(screen.getByText(/no online relays/i)).toBeInTheDocument();
  });
});
