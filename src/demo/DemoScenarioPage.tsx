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

  // Per VAL-CROSS-003: chrome toolbar Prev/Next must traverse canonical
  // scenarios only. When the active scenario is itself a variant, we anchor
  // navigation on its parent (variantOf) so Prev/Next return the user to the
  // canonical sequence.
  const canonicalScenarios = demoScenarios.filter((entry) => entry.canonical !== false);
  const canonicalAnchorId = scenario.canonical === false ? scenario.variantOf ?? scenario.id : scenario.id;
  const canonicalIndex = canonicalScenarios.findIndex((entry) => entry.id === canonicalAnchorId);
  const previous = canonicalIndex > 0 ? canonicalScenarios[canonicalIndex - 1] : undefined;
  const next = canonicalIndex >= 0 && canonicalIndex < canonicalScenarios.length - 1 ? canonicalScenarios[canonicalIndex + 1] : undefined;
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
      {rawMode ? (
        <div
          className="app-shell paper-reference-shell"
          data-scenario-id={scenario.id}
          data-expected-text={scenario.expectedText}
        >
          <img
            className="paper-reference-image"
            src={scenario.paperReference}
            alt={`${scenario.title} Paper reference`}
            draggable={false}
          />
        </div>
      ) : (
        <MockAppStateProvider key={scenario.id} value={scenario.appState}>
          <CoreRoutes location={scenarioLocation} relative />
        </MockAppStateProvider>
      )}
    </div>
  );
}
