import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { MockAppStateProvider } from "../app/AppState";
import { CoreRoutes } from "../app/CoreRoutes";
import { demoScenarioById, demoScenarios } from "./scenarios";

export function DemoScenarioPage() {
  const { scenarioId } = useParams();
  const outerLocation = useLocation();
  const scenario = scenarioId ? demoScenarioById.get(scenarioId) : undefined;

  if (!scenario) {
    return <Navigate to="/demo" replace />;
  }

  const index = demoScenarios.findIndex((entry) => entry.id === scenario.id);
  const previous = demoScenarios[index - 1];
  const next = demoScenarios[index + 1];
  const nestedPath = scenario.location.pathname === "/" ? "" : scenario.location.pathname;
  const rawMode = new URLSearchParams(outerLocation.search).get("chrome") === "0";
  const scenarioLocation = {
    ...scenario.location,
    pathname: `/demo/${scenario.id}${nestedPath}`
  };

  return (
    <div className="demo-scenario-shell">
      {rawMode ? null : (
        <aside className="demo-scenario-toolbar" aria-label="Demo scenario navigation">
          <Link to="/demo">All screens</Link>
          <span>{scenario.title}</span>
          {scenario.canonical === false ? <small>Variant of {scenario.variantOf}</small> : null}
          <span className="demo-scenario-spacer" />
          {previous ? <Link to={`/demo/${previous.id}`}>Previous</Link> : <span />}
          {next ? <Link to={`/demo/${next.id}`}>Next</Link> : <span />}
          <Link to={`/demo/${scenario.id}?chrome=0`}>Raw</Link>
          <a href={scenario.paperReference} target="_blank" rel="noreferrer">
            Reference
          </a>
        </aside>
      )}
      {/*
        key={scenario.id} forces React to remount MockAppStateProvider whenever
        the user navigates between scenarios (e.g. /demo/dashboard-running →
        /demo/welcome-first-time). MockAppStateProvider captures profiles /
        activeProfile / runtimeStatus / signerPaused / createSession from
        `value` into useState only at mount, so without this key the provider
        would keep scenario A's seed state when scenario B mounts with a new
        `value` prop. Remounting is simpler and safer than adding per-field
        useEffect resyncs — it also preserves the misc-bridge-hydrated-reset
        contract that mutators (clearCredentials / lockProfile) truly update
        the visible demo-shell state.
      */}
      <MockAppStateProvider key={scenario.id} value={scenario.appState}>
        <CoreRoutes location={scenarioLocation} relative />
      </MockAppStateProvider>
    </div>
  );
}
