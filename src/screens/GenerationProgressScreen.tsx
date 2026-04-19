import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppState } from "../app/AppState";
import { AppShell, PageHeading } from "../components/shell";
import { BackLink, Stepper } from "../components/ui";
import { useDemoUi } from "../demo/demoUi";

interface Phase {
  label: string;
  state: "done" | "active" | "pending";
}

const INITIAL_PHASES: Phase[] = [
  { label: "Generate New Key", state: "active" },
  { label: "Split Initial Shares", state: "pending" },
  { label: "Prepare Shares for Setup", state: "pending" }
];

export function GenerationProgressScreen() {
  const navigate = useNavigate();
  const { createSession } = useAppState();

  /* Guard: redirect if no keyset created */
  if (!createSession?.keyset) {
    return <Navigate to="/create" replace />;
  }

  return <GenerationProgressContent navigate={navigate} groupName={createSession.draft.groupName} />;
}

function GenerationProgressContent({
  navigate,
  groupName
}: {
  navigate: ReturnType<typeof useNavigate>;
  groupName: string;
}) {
  const demoUi = useDemoUi();
  const [phases, setPhases] = useState<Phase[]>(() => seedPhases(INITIAL_PHASES, demoUi.progress?.completedCount, demoUi.progress?.activeIndex));

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

  /* Auto-advance phases */
  useEffect(() => {
    if (demoUi.progress?.frozen) {
      return;
    }

    if (allDone) {
      const timer = window.setTimeout(() => {
        navigate("/create/profile", { replace: true });
      }, 600);
      return () => window.clearTimeout(timer);
    }

    const hasActive = phases.some((p) => p.state === "active");
    if (hasActive) {
      const timer = window.setTimeout(advancePhase, 800);
      return () => window.clearTimeout(timer);
    }
  }, [phases, allDone, navigate, advancePhase, demoUi.progress?.frozen]);

  const progressPercent = (doneCount / phases.length) * 100;

  return (
    <AppShell headerMeta={groupName} mainVariant="flow">
      <div className="screen-column">
        <Stepper current={1} variant="create" />
        <BackLink onClick={() => navigate("/create")} />
        <PageHeading
          title="Generation Progress"
          copy="Generating a new signing key and preparing initial shares for profile setup."
        />

        <div className="generation-progress-card">
          {phases.map((phase) => (
            <div className={`generation-phase ${phase.state}`} key={phase.label}>
              <PhaseDot state={phase.state} />
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

function seedPhases(phases: Phase[], completedCount?: number, activeIndex?: number): Phase[] {
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

function PhaseDot({ state }: { state: "done" | "active" | "pending" }) {
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
