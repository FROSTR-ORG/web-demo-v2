import { Link } from "react-router-dom";
import { AppShell } from "../components/shell";
import { demoFlows, demoScenarios } from "./scenarios";

const flowLabels: Record<string, string> = {
  welcome: "Welcome",
  import: "Import",
  onboard: "Onboard",
  create: "Create",
  shared: "Shared",
  dashboard: "Dashboard",
  "rotate-keyset": "Rotate Keyset",
  "rotate-share": "Rotate Share",
  recover: "Recover"
};

export function DemoGallery() {
  return (
    <AppShell mainVariant="flow" headerMeta="Mock gallery">
      <section className="demo-gallery">
        <div className="screen-heading">
          <h1 className="page-title">Paper Screen Gallery</h1>
          <p className="page-copy">Direct review links for every mocked Paper state in WebDemo V2.</p>
        </div>
        <div className="demo-flow-list">
          {demoFlows.map((flow) => {
            // Per VAL-CROSS-001: only canonical scenarios are listed as
            // top-level gallery links; variants (canonical: false) are
            // reachable only by direct URL and through the chrome toolbar
            // of their parent scenario.
            const scenarios = demoScenarios.filter((entry) => entry.flow === flow && entry.canonical !== false);
            return (
              <section className="demo-flow-group" key={flow}>
                <div className="demo-flow-heading">
                  <h2>{flowLabels[flow]}</h2>
                  <span>{scenarios.length} screens</span>
                </div>
                <div className="demo-link-grid">
                  {scenarios.map((scenario) => (
                    <Link className="demo-scenario-link" to={`/demo/${scenario.id}`} key={scenario.id}>
                      <span>{scenario.title}</span>
                      <small>{scenario.paperPath}</small>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
