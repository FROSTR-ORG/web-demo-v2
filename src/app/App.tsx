import { Route } from "react-router-dom";
import { CoreRoutes } from "./CoreRoutes";
import { DemoGallery } from "../demo/DemoGallery";
import { DemoScenarioPage } from "../demo/DemoScenarioPage";

export function App() {
  return (
    <CoreRoutes
      extraRoutes={
        <>
          <Route path="/demo" element={<DemoGallery />} />
          <Route path="/demo/:scenarioId/*" element={<DemoScenarioPage />} />
        </>
      }
    />
  );
}
