import { Navigate, Route, Routes } from "react-router-dom";
import { CreateKeysetScreen } from "../screens/CreateKeysetScreen";
import { CreateProfileScreen } from "../screens/CreateProfileScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DistributeSharesScreen } from "../screens/DistributeSharesScreen";
import { DistributionCompleteScreen } from "../screens/DistributionCompleteScreen";
import { LoadBackupScreen, DecryptBackupScreen, ReviewSaveScreen, ImportErrorScreen } from "../screens/ImportScreens";
import { EnterPackageScreen, HandshakeScreen, OnboardingFailedScreen, OnboardingCompleteScreen } from "../screens/OnboardScreens";
import { WelcomeScreen } from "../screens/WelcomeScreen";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/create" element={<CreateKeysetScreen />} />
      <Route path="/create/profile" element={<CreateProfileScreen />} />
      <Route path="/create/distribute" element={<DistributeSharesScreen />} />
      <Route path="/create/complete" element={<DistributionCompleteScreen />} />
      <Route path="/import" element={<LoadBackupScreen />} />
      <Route path="/import/decrypt" element={<DecryptBackupScreen />} />
      <Route path="/import/review" element={<ReviewSaveScreen />} />
      <Route path="/import/error" element={<ImportErrorScreen />} />
      <Route path="/onboard" element={<EnterPackageScreen />} />
      <Route path="/onboard/handshake" element={<HandshakeScreen />} />
      <Route path="/onboard/failed" element={<OnboardingFailedScreen />} />
      <Route path="/onboard/complete" element={<OnboardingCompleteScreen />} />
      <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

