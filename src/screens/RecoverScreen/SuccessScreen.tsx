import { useDemoUi } from "../../demo/demoUi";
import { DemoRecoverSuccessScreen } from "./DemoSuccessScreen";
import { ProductRecoverSuccessScreen } from "./ProductSuccessScreen";

export function RecoverSuccessScreen() {
  const demoUi = useDemoUi();
  if (demoUi.recover) {
    return <DemoRecoverSuccessScreen />;
  }
  return <ProductRecoverSuccessScreen />;
}
