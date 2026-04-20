import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../../app/AppState";
import { AppShell, PageHeading } from "../../components/shell";
import { BackLink, Stepper } from "../../components/ui";
import { useDemoUi } from "../../demo/demoUi";
import { MOCK_SOURCE_SHARE_1 } from "./mocks";
import type { RotatePhase } from "./types";
import { navigateWithRotateState, rotatePhaseAtLeast } from "./utils";

const ROTATE_INITIAL_PHASES: RotatePhase[] = [
  { label: "Process Source Shares", state: "active" },
  { label: "Recover Existing Key", state: "pending" },
  { label: "Generate Fresh Shares", state: "pending" },
  { label: "Prepare Rotated Shares", state: "pending" }
];

export function RotateGenerationProgressScreen() {
  const navigate = useNavigate();
  const demoUi = useDemoUi();
  const { rotateKeysetSession } = useAppState();
  const routeState = rotateKeysetSession ? { profileId: rotateKeysetSession.sourceProfile.id } : undefined;
  const demoProgress = Boolean(demoUi.progress);
  const blocked = !rotatePhaseAtLeast(rotateKeysetSession, "rotated") && !demoProgress;
  const [phases, setPhases] = useState<RotatePhase[]>(() => seedRotatePhases(ROTATE_INITIAL_PHASES, demoUi.progress?.completedCount, demoUi.progress?.activeIndex));

  const doneCount = phases.filter((p) => p.state === "done").length;
  const allDone = phases.every((p) => p.state === "done");

  const advancePhase = useCallback(() => {
    setPhases((prev) => {
      const activeIdx = prev.findIndex((p) => p.state === "active");
      if (activeIdx === -1) return prev;
      return prev.map((p, i) => {
        if (i === activeIdx) return { ...p, state: "done" as const };
        if (i === activeIdx + 1) return { ...p, state: "active" as const };
        return p;
      });
    });
  }, []);

  useEffect(() => {
    if (blocked) {
      return;
    }
    if (demoUi.progress?.frozen) {
      return;
    }

    if (allDone) {
      const timer = window.setTimeout(() => {
        navigateWithRotateState(navigate, "/rotate-keyset/profile", routeState, { replace: true });
      }, 600);
      return () => window.clearTimeout(timer);
    }

    const hasActive = phases.some((p) => p.state === "active");
    if (hasActive) {
      const timer = window.setTimeout(advancePhase, 800);
      return () => window.clearTimeout(timer);
    }
  }, [phases, allDone, navigate, advancePhase, demoUi.progress?.frozen, blocked]);

  const progressPercent = (doneCount / phases.length) * 100;

  if (blocked) {
    return <Navigate to="/rotate-keyset/review" replace />;
  }

  return (
    <AppShell headerMeta={rotateKeysetSession?.sourceProfile.label ?? MOCK_SOURCE_SHARE_1.label} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="rotate-keyset" />
        <BackLink onClick={() => navigateWithRotateState(navigate, "/rotate-keyset/review", routeState)} />
        <PageHeading
          title="Generation Progress"
          copy="Reconstructing the current keyset and preparing fresh shares for the same group public key."
        />

        <div className="generation-progress-card">
          {phases.map((phase) => (
            <div className={`generation-phase ${phase.state}`} key={phase.label}>
              <RotatePhaseDot state={phase.state} />
              <span className="generation-phase-label">{phase.label}</span>
              {phase.state === "done" && <span className="generation-phase-status">Done</span>}
              {phase.state === "active" && <span className="generation-phase-status">Processing...</span>}
            </div>
          ))}
        </div>

        <div className="progress-bar-section">
          <div className="progress-bar-header">
            <span className="progress-bar-title">Overall Progress</span>
            <span className="progress-bar-count">{doneCount} of {phases.length} phases</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function seedRotatePhases(phases: RotatePhase[], completedCount?: number, activeIndex?: number): RotatePhase[] {
  if (completedCount === undefined && activeIndex === undefined) {
    return phases;
  }
  const doneLimit = completedCount ?? 0;
  const active = activeIndex ?? doneLimit;
  return phases.map((phase, index) => ({
    ...phase,
    state: index < doneLimit ? "done" : index === active ? "active" : "pending"
  }));
}

function RotatePhaseDot({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="generation-phase-dot done">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="7.5" stroke="#4ADE80" strokeWidth="1.5" />
          <path d="M6.75 10.25L8.9 12.35L13.25 7.95" stroke="#4ADE80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return <span className="generation-phase-dot active" />;
  }
  return <span className="generation-phase-dot pending" />;
}
