import { useDemoUi } from "../../../demo/demoUi";
import { DemoCollectSharesContent } from "../../RecoverScreen/DemoCollectSharesScreen";
import { DemoRecoverSuccessContent } from "../../RecoverScreen/DemoSuccessScreen";
import { ProductCollectSharesContent } from "../../RecoverScreen/ProductCollectSharesScreen";
import { ProductRecoverSuccessContent } from "../../RecoverScreen/ProductSuccessScreen";
import type { DashboardRecoverStep } from "../types";

interface DashboardRecoverPanelProps {
  profileId: string;
  paperPanels: boolean;
  recoverStep: DashboardRecoverStep;
  onRecovered: () => void;
  onExit: () => void;
}

export function DashboardRecoverPanel({
  profileId,
  paperPanels,
  recoverStep,
  onRecovered,
  onExit,
}: DashboardRecoverPanelProps) {
  const demoUi = useDemoUi();
  const dashboardRecoverVariant =
    demoUi.dashboard?.recoverVariant === "incompatible-shares"
      ? "incompatible-shares"
      : undefined;

  return (
    <div className="dashboard-recover-panel" data-testid="dashboard-recover-panel">
      {paperPanels ? (
        recoverStep === "success" ? (
          <DemoRecoverSuccessContent
            profileId={profileId}
            copied={demoUi.dashboard?.recoverCopied}
            onClear={onExit}
          />
        ) : (
          <DemoCollectSharesContent
            profileId={profileId}
            variant={dashboardRecoverVariant}
            onRecovered={onRecovered}
          />
        )
      ) : recoverStep === "success" ? (
        <ProductRecoverSuccessContent
          profileId={profileId}
          onExit={onExit}
          onExpired={onExit}
        />
      ) : (
        <ProductCollectSharesContent
          profileId={profileId}
          onRecovered={onRecovered}
        />
      )}
    </div>
  );
}
