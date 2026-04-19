import { Navigate, Route, Routes } from "react-router-dom";
import { CreateKeysetScreen } from "../screens/CreateKeysetScreen";
import { CreateProfileScreen } from "../screens/CreateProfileScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DistributeSharesScreen } from "../screens/DistributeSharesScreen";
import { DistributionCompleteScreen } from "../screens/DistributionCompleteScreen";
import { GenerationProgressScreen } from "../screens/GenerationProgressScreen";
import { LoadBackupScreen, DecryptBackupScreen, ReviewSaveScreen, ImportErrorScreen } from "../screens/ImportScreens";
import { EnterPackageScreen, HandshakeScreen, OnboardingFailedScreen, OnboardingCompleteScreen } from "../screens/OnboardScreens";
import { CollectSharesScreen, RecoverSuccessScreen } from "../screens/RecoverScreens";
import {
  RotateKeysetFormScreen,
  ReviewGenerateScreen,
  RotateGenerationProgressScreen,
  RotateWrongPasswordScreen,
  RotateGroupMismatchScreen,
  RotateGenerationFailedScreen,
  RotateCreateProfileScreen,
  RotateDistributeSharesScreen,
  RotateDistributionCompleteScreen
} from "../screens/RotateKeysetScreens";
import {
  EnterRotatePackageScreen,
  ApplyingShareUpdateScreen,
  ShareUpdateFailedScreen,
  LocalShareUpdatedScreen
} from "../screens/RotateShareScreens";
import { WelcomeScreen } from "../screens/WelcomeScreen";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/create" element={<CreateKeysetScreen />} />
      <Route path="/create/progress" element={<GenerationProgressScreen />} />
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
      <Route path="/rotate-keyset" element={<RotateKeysetFormScreen />} />
      <Route path="/rotate-keyset/review" element={<ReviewGenerateScreen />} />
      <Route path="/rotate-keyset/progress" element={<RotateGenerationProgressScreen />} />
      <Route path="/rotate-keyset/error-password" element={<RotateWrongPasswordScreen />} />
      <Route path="/rotate-keyset/error-mismatch" element={<RotateGroupMismatchScreen />} />
      <Route path="/rotate-keyset/error-failed" element={<RotateGenerationFailedScreen />} />
      <Route path="/rotate-keyset/profile" element={<RotateCreateProfileScreen />} />
      <Route path="/rotate-keyset/distribute" element={<RotateDistributeSharesScreen />} />
      <Route path="/rotate-keyset/complete" element={<RotateDistributionCompleteScreen />} />
      <Route path="/rotate-share" element={<EnterRotatePackageScreen />} />
      <Route path="/rotate-share/applying" element={<ApplyingShareUpdateScreen />} />
      <Route path="/rotate-share/failed" element={<ShareUpdateFailedScreen />} />
      <Route path="/rotate-share/updated" element={<LocalShareUpdatedScreen />} />
      <Route path="/recover/:profileId" element={<CollectSharesScreen />} />
      <Route path="/recover/:profileId/success" element={<RecoverSuccessScreen />} />
      <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

