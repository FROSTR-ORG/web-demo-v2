import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardScreen } from "../DashboardScreen";

const mockCreateTestGroup = vi.fn(async () => ({ profileId: "test-group-profile" }));
const mockMarkPackageDistributed = vi.fn();

const activeProfile = {
  id: "test-profile-id",
  label: "Test Key",
  deviceName: "Igloo Web",
  groupName: "My Signing Key",
  threshold: 2,
  memberCount: 3,
  localShareIdx: 0,
  groupPublicKey: "b".repeat(64),
  relays: ["wss://relay.primal.net"],
  createdAt: Date.now(),
  lastUsedAt: Date.now(),
};

const runtimeStatus = {
  metadata: {
    member_idx: 0,
    share_public_key: "a".repeat(64),
    group_public_key: "b".repeat(64),
  },
  readiness: {
    runtime_ready: true,
    restore_complete: true,
    degraded_reasons: [],
    signing_peer_count: 2,
    ecdh_peer_count: 2,
    threshold: 2,
    sign_ready: true,
    ecdh_ready: true,
    last_refresh_at: null,
  },
  peers: [
    {
      idx: 0,
      pubkey: "local",
      online: true,
      can_sign: true,
      should_send_nonces: true,
      incoming_available: 10,
      outgoing_available: 10,
    },
  ],
  pending_operations: [],
};

const mockAppState = {
  activeProfile,
  runtimeStatus,
  runtimeRelays: [],
  peerLatencyByPubkey: {},
  signerPaused: false,
  createSession: null as unknown,
  createTestGroup: mockCreateTestGroup,
  markPackageDistributed: mockMarkPackageDistributed,
  getCreateSessionPackageSecret: (idx: number) =>
    idx === 2 || idx === 3
      ? { packageText: `bfonboard1package-${idx}`, password: "1234" }
      : null,
  lockProfile: vi.fn(),
  clearCredentials: vi.fn(async () => undefined),
  clearRecoverSession: vi.fn(),
  setSignerPaused: vi.fn(),
  refreshRuntime: vi.fn(),
  exportRuntimePackages: vi.fn(),
  restartRuntimeConnections: vi.fn(),
  runtimeFailures: [],
  pendingDispatchIndex: {},
  signDispatchLog: {},
  handleRuntimeCommand: vi.fn(),
  lifecycleEvents: [],
  peerDenialQueue: [],
  enqueuePeerDenial: vi.fn(),
  resolvePeerDenial: vi.fn(),
};

vi.mock("../../app/AppState", () => ({
  useAppState: () => mockAppState,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

function renderTestPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/test-profile-id/test"]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/dashboard/:profileId/test"
          element={<DashboardScreen mode="test" />}
        />
        <Route
          path="/dashboard/:profileId"
          element={<div data-testid="normal-dashboard">Dashboard</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockCreateTestGroup.mockClear();
  mockMarkPackageDistributed.mockClear();
  mockAppState.createSession = null;
});

describe("Test Group stage page", () => {
  it("opens Test Group as the default test tab and keeps runtime tools under Runtime Tests", () => {
    renderTestPage();

    expect(screen.getByTestId("test-group-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("test-sign-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Runtime Tests" }));

    expect(screen.getByTestId("test-sign-panel")).toBeInTheDocument();
  });

  it("submits a customizable group with the visible default password 1234", async () => {
    renderTestPage();

    expect(screen.getByDisplayValue("1234")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Test Group"), {
      target: { value: "Stage Test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Test Group" }));

    await waitFor(() => {
      expect(mockCreateTestGroup).toHaveBeenCalledWith({
        groupName: "Stage Test",
        threshold: 2,
        count: 5,
        password: "1234",
        extraRelays: [],
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("location-pathname").textContent).toBe(
        "/dashboard/test-group-profile/test",
      );
    });
  });

  it("previews and submits an optional tunnel relay", async () => {
    renderTestPage();

    expect(screen.getByText("Final relay list")).toBeInTheDocument();
    expect(screen.getByText("wss://relay.primal.net")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("wss://your-ngrok-url.ngrok-free.app"), {
      target: { value: "wss://stage-demo.ngrok-free.app" },
    });

    expect(
      screen.getByText("wss://stage-demo.ngrok-free.app"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Test Group" }));

    await waitFor(() => {
      expect(mockCreateTestGroup).toHaveBeenCalledWith({
        groupName: "",
        threshold: 2,
        count: 5,
        password: "1234",
        extraRelays: ["wss://stage-demo.ngrok-free.app"],
      });
    });
  });

  it("renders request-seen packages without false green and counts manual joins", () => {
    mockAppState.activeProfile = {
      ...activeProfile,
      id: "test-profile-id",
      groupName: "Stage Test",
      threshold: 2,
      memberCount: 3,
    };
    mockAppState.createSession = {
      draft: { groupName: "Stage Test", threshold: 2, count: 3 },
      createdProfileId: "test-profile-id",
      onboardingPackages: [
        {
          idx: 2,
          memberPubkey: "remote-2",
          packageText: "bfonboard1preview-2",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: true,
          manuallyMarkedDistributed: false,
          packageCopied: false,
          passwordCopied: false,
          copied: false,
          qrShown: false,
        },
        {
          idx: 3,
          memberPubkey: "remote-3",
          packageText: "bfonboard1preview-3",
          password: "[redacted]",
          packageCreated: true,
          peerOnline: true,
          manuallyMarkedDistributed: true,
          packageCopied: false,
          passwordCopied: false,
          copied: false,
          qrShown: false,
        },
      ],
    };

    renderTestPage();

    expect(screen.getByText("1/2 joined")).toBeInTheDocument();
    expect(screen.getByText("1 request seen")).toBeInTheDocument();
    expect(screen.getByText(/Password:/).textContent).toContain("1234");
    expect(screen.getByTestId("test-group-package-2")).toBeInTheDocument();
    expect(screen.getByText("Request seen")).toBeInTheDocument();
    expect(screen.getByText(/Source saw this share request/)).toBeInTheDocument();
    expect(screen.getByTestId("test-group-joined-3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark joined" }));

    expect(mockMarkPackageDistributed).toHaveBeenCalledWith(2);
  });
});
