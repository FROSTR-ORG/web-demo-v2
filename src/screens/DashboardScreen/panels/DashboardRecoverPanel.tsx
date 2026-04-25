import { useDemoUi } from "../../../demo/demoUi";
import {
  DemoCollectSharesContent,
  type RecoverVariant,
} from "../../RecoverScreen/DemoCollectSharesScreen";
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
  onExpired: () => void;
}

const allowedRecoverVariants = new Set<RecoverVariant>([
  "incompatible-shares",
]);

export function DashboardRecoverPanel({
  profileId,
  paperPanels,
  recoverStep,
  onRecovered,
  onExit,
  onExpired,
}: DashboardRecoverPanelProps) {
  const demoUi = useDemoUi();
  const requestedRecoverVariant = demoUi.dashboard?.recoverVariant;
  const dashboardRecoverVariant =
    requestedRecoverVariant &&
    allowedRecoverVariants.has(requestedRecoverVariant)
      ? requestedRecoverVariant
      : undefined;

  if (
    import.meta.env.DEV &&
    requestedRecoverVariant &&
    !allowedRecoverVariants.has(requestedRecoverVariant)
  ) {
    console.warn(
      `Unknown dashboard recover variant: ${requestedRecoverVariant}`,
    );
  }

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
          onExpired={onExpired}
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
