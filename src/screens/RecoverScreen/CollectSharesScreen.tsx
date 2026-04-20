import { useDemoUi } from "../../demo/demoUi";
import { DemoCollectSharesScreen } from "./DemoCollectSharesScreen";
import { ProductCollectSharesScreen } from "./ProductCollectSharesScreen";

export function CollectSharesScreen() {
  const demoUi = useDemoUi();
  if (demoUi.recover) {
    return <DemoCollectSharesScreen />;
  }
  return <ProductCollectSharesScreen />;
}
