import { ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { StatusPill } from "../../../components/ui";
import { shortHex } from "../../../lib/bifrost/format";
import type {
  PendingOperation,
  PeerStatus,
} from "../../../lib/bifrost/types";
import type { DashboardApprovalRow, PolicyPromptRequest } from "../mocks";

/**
 * Module-level memo — the panel's collapsed/expanded state persists
 * across component unmount+remount within the current page load (so
 * navigating Dashboard → Settings → Dashboard restores the previous
 * toggle) but resets to expanded on a full page reload (fresh module
 * evaluation reinitialises the memo). See VAL-APPROVALS-005.
 */
let collapsedMemo = false;

/**
 * Test-only hook: reset the module-level collapse memo. Simulates a
 * page reload so each test starts with the panel expanded.
 */
export function __resetPendingApprovalsCollapseForTest(): void {
  collapsedMemo = false;
}

/**
 * Format a TTL duration (in milliseconds) as the Paper-reference string.
 * Negative or sub-second values render as `0s`. Under a minute renders
 * as `{N}s`; over a minute renders as `{M}m {SS}s` with zero-padded
 * seconds (matches Paper: "42s", "1m 12s", "3m 05s").
 */
export function formatApprovalTtl(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0s";
  const totalSeconds = Math.floor(remainingMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function opTypeToKind(
  opType: PendingOperation["op_type"],
): DashboardApprovalRow["kind"] {
  switch (opType) {
    case "Sign":
      return "SIGN";
    case "Ecdh":
      return "ECDH";
    case "Ping":
      return "PING";
    case "Onboard":
      return "ONBOARD";
  }
}

function verbPrefix(kind: DashboardApprovalRow["kind"]): string {
  switch (kind) {
    case "SIGN":
      return "Sign:";
    case "ECDH":
      return "ECDH:";
    case "PING":
      return "Ping:";
    case "ONBOARD":
      return "Onboard:";
  }
}

/**
 * Convert a byte array (e.g. a serialized `Bytes32`) into a lowercase
 * hex string, returning null if any element is not a valid byte. Used
 * to decode the real runtime `session.hashes[0]` payload, which
 * bifrost-rs serializes as `[u8; 32]` → array of numbers rather than a
 * pre-encoded hex string. Returns null for anything that is not a
 * non-empty array of integers in `[0, 255]`.
 */
function byteArrayToHex(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  let hex = "";
  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      return null;
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Safely pull a 10-hex-char preview of the sign message from a pending
 * operation's opaque `context` field. Handles the real runtime nested
 * `SignSession` shape emitted by bifrost-rs as well as defensive
 * variants and any legacy flat shape.
 *
 * Observed runtime shape (via `__debug.runtimeStatus()` /
 * bifrost-devtools, see architecture.md → "Runtime `pending_operations`
 * Context Shapes"):
 *
 * ```
 * context = {
 *   SignSession: {
 *     session: {
 *       hashes: [[u8; 32]],       // array-of-numbers Bytes32
 *       ...
 *     },
 *     partials: [...],
 *   }
 * }
 * ```
 *
 * Paths attempted, in order:
 *   1. `context.SignSession.session.hashes[0]` (real runtime byte array)
 *   2. `context.SignSession.session.message_hex_32` (defensive)
 *   3. `context.SignSession.session.message_hex` (defensive)
 *   4. `context.session.hashes[0]` (defensive byte array)
 *   5. `context.session.message_hex_32` (defensive)
 *   6. `context.session.message_hex` (defensive)
 *   7. `context.message_hex_32` (legacy flat)
 *   8. `context.message_hex` (legacy flat)
 *
 * Returns null if none match or context is malformed/non-object (e.g.
 * the serialized unit-variant string `"PingRequest"`). Keeps the
 * payload extraction type-narrow so malformed / missing context never
 * surfaces as `[object Object]` or crashes the render.
 */
function extractMessagePreview(ctx: unknown): string | null {
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) return null;
  const record = ctx as Record<string, unknown>;

  // Collect candidate `session` objects in priority order: first the
  // real-runtime nested-under-SignSession path, then the defensive
  // shallow-nested path.
  const nestedSignSession =
    record.SignSession &&
    typeof record.SignSession === "object" &&
    !Array.isArray(record.SignSession)
      ? (record.SignSession as Record<string, unknown>)
      : null;
  const nestedSessionFromSignSession =
    nestedSignSession &&
    typeof nestedSignSession.session === "object" &&
    nestedSignSession.session !== null &&
    !Array.isArray(nestedSignSession.session)
      ? (nestedSignSession.session as Record<string, unknown>)
      : null;
  const shallowNestedSession =
    typeof record.session === "object" &&
    record.session !== null &&
    !Array.isArray(record.session)
      ? (record.session as Record<string, unknown>)
      : null;

  const sessionCandidates = [
    nestedSessionFromSignSession,
    shallowNestedSession,
  ].filter((entry): entry is Record<string, unknown> => entry !== null);

  for (const session of sessionCandidates) {
    const hashes = session.hashes;
    if (Array.isArray(hashes) && hashes.length > 0) {
      const hex = byteArrayToHex(hashes[0]);
      if (hex) return hex.slice(0, 10).toLowerCase();
    }
    if (typeof session.message_hex_32 === "string" && session.message_hex_32.length > 0) {
      return session.message_hex_32.slice(0, 10).toLowerCase();
    }
    if (typeof session.message_hex === "string" && session.message_hex.length > 0) {
      return session.message_hex.slice(0, 10).toLowerCase();
    }
  }

  // Legacy flat context shape, kept for back-compat / defensive parsing
  // so synthetic fixtures and older tests continue to render.
  const flatCandidate =
    typeof record.message_hex_32 === "string"
      ? record.message_hex_32
      : typeof record.message_hex === "string"
        ? record.message_hex
        : null;
  if (!flatCandidate) return null;
  return flatCandidate.slice(0, 10).toLowerCase();
}

/**
 * Derive the panel's display rows from the live
 * `runtime_status.pending_operations` snapshot. Each row is populated
 * with:
 *   - `kind`: SIGN / ECDH / PING / ONBOARD pill
 *   - `peer`: "Peer #<idx>" if the target peer is in the current peers
 *     list; otherwise the truncated short key as a fallback
 *   - `key`: short hex of the first target peer (6...4)
 *   - `detail`: verb-prefixed description with peer short id and, for
 *     sign ops, the first 10 hex chars of the message
 *   - `ttl`: countdown string from `timeout_at - now` (where
 *     `timeout_at` is a unix-seconds timestamp per the runtime wire
 *     protocol)
 */
export function deriveApprovalRowsFromRuntime(
  pendingOps: PendingOperation[],
  peers: PeerStatus[],
  nowMs: number,
): DashboardApprovalRow[] {
  const peerByPubkey = new Map<string, PeerStatus>();
  for (const peer of peers) {
    peerByPubkey.set(peer.pubkey.toLowerCase(), peer);
  }

  return pendingOps.map((op) => {
    const kind = opTypeToKind(op.op_type);
    const targetPubkey = op.target_peers[0] ?? "";
    const normalizedTarget = targetPubkey.toLowerCase();
    const peer = peerByPubkey.get(normalizedTarget);
    const shortKey = targetPubkey ? shortHex(targetPubkey, 6, 4) : "";
    const peerLabel = peer ? `Peer #${peer.idx}` : shortKey || "Unknown peer";
    const remainingMs = op.timeout_at * 1000 - nowMs;
    const ttl = formatApprovalTtl(remainingMs);
    const messagePreview =
      kind === "SIGN" ? extractMessagePreview(op.context) : null;
    const detailParts = [verbPrefix(kind), shortKey || targetPubkey || "(unknown peer)"];
    if (messagePreview) detailParts.push(messagePreview);
    const detail = detailParts.filter(Boolean).join(" ").trim();
    return {
      id: op.request_id,
      kind,
      peer: peerLabel,
      key: shortKey,
      detail,
      ttl,
    };
  });
}

/**
 * `PendingApprovalsPanel`: runtime-driven panel rendering one row per
 * entry in `runtime_status.pending_operations`. In demo/Paper mode the
 * caller passes the Paper-fixture rows directly via `rows`; in
 * production runtime mode the caller derives rows from pending_operations
 * via {@link deriveApprovalRowsFromRuntime} and passes them in.
 *
 * Collapse state is held in a module-level memo so it survives
 * re-mounts within the same page load (tab switches) but resets to the
 * default (expanded) on a full page reload.
 *
 * When `rows` is empty, the panel renders a visible empty-state
 * ("No pending operations") and hides the Nearest SLA label.
 */
export function PendingApprovalsPanel({
  rows,
  onOpenPolicyPrompt,
  nearest,
}: {
  rows: DashboardApprovalRow[];
  onOpenPolicyPrompt?: (request: PolicyPromptRequest) => void;
  /**
   * Optional override for the "Nearest: <ttl>" header label. When not
   * provided, the first row's TTL is used (rows are already ordered by
   * ascending TTL at the caller). Hidden when the panel is empty.
   */
  nearest?: string;
}) {
  // Seed local state from the module-level memo so re-mounts within a
  // session see the prior toggle (persists across tab switches). The
  // memo is reset on a full reload (module re-evaluation) — so initial
  // load is always expanded.
  const [collapsed, setCollapsed] = useState<boolean>(collapsedMemo);

  // Keep local state and module memo in sync if external logic resets
  // the memo mid-session (e.g. via the test helper).
  useEffect(() => {
    collapsedMemo = collapsed;
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      collapsedMemo = next;
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleCollapsed();
      }
    },
    [toggleCollapsed],
  );

  const hasRows = rows.length > 0;
  const nearestLabel = useMemo(() => {
    if (!hasRows) return null;
    if (typeof nearest === "string" && nearest.length > 0) return nearest;
    return rows[0]?.ttl ?? null;
  }, [hasRows, nearest, rows]);

  const expanded = !collapsed;

  return (
    <div
      className="pending-approvals-panel"
      data-testid="pending-approvals-panel"
    >
      <div
        className="pending-approvals-header"
        data-testid="pending-approvals-header"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls="pending-approvals-body"
        aria-label={
          expanded
            ? "Collapse pending approvals"
            : "Expand pending approvals"
        }
        onClick={toggleCollapsed}
        onKeyDown={handleKeyDown}
        style={{ cursor: "pointer" }}
      >
        <span className="pending-star">✦</span>
        <div className="pending-title">Pending Approvals</div>
        <StatusPill tone="warning">{rows.length} pending</StatusPill>
        <span className="event-log-spacer" />
        {hasRows && nearestLabel ? (
          <>
            <Clock size={12} />
            <span className="pending-nearest">Nearest: {nearestLabel}</span>
          </>
        ) : null}
        {expanded ? (
          <ChevronDown size={14} aria-hidden />
        ) : (
          <ChevronRight size={14} aria-hidden />
        )}
      </div>
      {expanded ? (
        hasRows ? (
          <div id="pending-approvals-body" data-testid="pending-approvals-body">
            {rows.map((row, rowIdx) => (
              <div className="pending-row" key={row.id} data-row-id={row.id}>
                <span className="pending-dot" />
                <span className={`pending-kind ${row.kind.toLowerCase()}`}>
                  {row.kind}
                </span>
                <span className="pending-peer">{row.peer}</span>
                <span className="pending-key">{row.key}</span>
                <span className="pending-detail">{row.detail}</span>
                <span className="pending-ttl">{row.ttl}</span>
                {onOpenPolicyPrompt && row.request ? (
                  <button
                    type="button"
                    className="pending-open"
                    onClick={(event) => {
                      // Avoid bubbling to the header's collapse toggle.
                      event.stopPropagation();
                      onOpenPolicyPrompt(row.request!);
                    }}
                    aria-label={`Open approval ${rowIdx + 1}`}
                  >
                    Open
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div
            id="pending-approvals-body"
            className="pending-empty"
            data-testid="pending-approvals-empty"
            role="status"
          >
            No pending operations
          </div>
        )
      ) : null}
    </div>
  );
}
