import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { CreateKeysetScreen } from "../screens/CreateKeysetScreen";
import { CreateProfileScreen } from "../screens/CreateProfileScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DistributeSharesScreen } from "../screens/DistributeSharesScreen";
import { DistributionCompleteScreen } from "../screens/DistributionCompleteScreen";
import { GenerationProgressScreen } from "../screens/GenerationProgressScreen";
import { LoadBackupScreen, DecryptBackupScreen, ReviewSaveScreen, ImportErrorScreen } from "../screens/ImportScreens";
import { EnterPackageScreen, HandshakeScreen, OnboardingFailedScreen, OnboardingCompleteScreen } from "../screens/OnboardScreens";
import { OnboardSponsorConfigScreen, OnboardSponsorHandoffScreen } from "../screens/OnboardSponsorScreens";
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
  EnterReplacePackageScreen,
  ApplyingReplacementScreen,
  ReplacementFailedScreen,
  ShareReplacedScreen
} from "../screens/ReplaceShareScreens";
import { RestoreFromRelayScreen } from "../screens/RestoreFromRelayScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";

type RoutesLocation = Parameters<typeof Routes>[0]["location"];

function pathFor(path: string, relative: boolean) {
  return relative ? path.replace(/^\//, "") : path;
}

export function CoreRoutes({ location, extraRoutes, relative = false }: { location?: RoutesLocation; extraRoutes?: ReactNode; relative?: boolean }) {
  return (
    <Routes location={location}>
      {extraRoutes}
      {relative ? <Route index element={<WelcomeScreen />} /> : <Route path="/" element={<WelcomeScreen />} />}
      <Route path={pathFor("/create", relative)} element={<CreateKeysetScreen />} />
      <Route path={pathFor("/create/progress", relative)} element={<GenerationProgressScreen />} />
      <Route path={pathFor("/create/profile", relative)} element={<CreateProfileScreen />} />
      <Route path={pathFor("/create/distribute", relative)} element={<DistributeSharesScreen />} />
      <Route path={pathFor("/create/complete", relative)} element={<DistributionCompleteScreen />} />
      <Route path={pathFor("/restore-from-relay", relative)} element={<RestoreFromRelayScreen />} />
      <Route path={pathFor("/import", relative)} element={<LoadBackupScreen />} />
      <Route path={pathFor("/import/decrypt", relative)} element={<DecryptBackupScreen />} />
      <Route path={pathFor("/import/review", relative)} element={<ReviewSaveScreen />} />
      <Route path={pathFor("/import/error", relative)} element={<ImportErrorScreen />} />
      <Route path={pathFor("/onboard", relative)} element={<EnterPackageScreen />} />
      <Route path={pathFor("/onboard/handshake", relative)} element={<HandshakeScreen />} />
      <Route path={pathFor("/onboard/failed", relative)} element={<OnboardingFailedScreen />} />
      <Route path={pathFor("/onboard/complete", relative)} element={<OnboardingCompleteScreen />} />
      <Route path={pathFor("/onboard-sponsor", relative)} element={<OnboardSponsorConfigScreen />} />
      <Route path={pathFor("/onboard-sponsor/handoff", relative)} element={<OnboardSponsorHandoffScreen />} />
      <Route path={pathFor("/rotate-keyset", relative)} element={<RotateKeysetFormScreen />} />
      <Route path={pathFor("/rotate-keyset/review", relative)} element={<ReviewGenerateScreen />} />
      <Route path={pathFor("/rotate-keyset/progress", relative)} element={<RotateGenerationProgressScreen />} />
      <Route path={pathFor("/rotate-keyset/error-password", relative)} element={<RotateWrongPasswordScreen />} />
      <Route path={pathFor("/rotate-keyset/error-mismatch", relative)} element={<RotateGroupMismatchScreen />} />
      <Route path={pathFor("/rotate-keyset/error-failed", relative)} element={<RotateGenerationFailedScreen />} />
      <Route path={pathFor("/rotate-keyset/profile", relative)} element={<RotateCreateProfileScreen />} />
      <Route path={pathFor("/rotate-keyset/distribute", relative)} element={<RotateDistributeSharesScreen />} />
      <Route path={pathFor("/rotate-keyset/complete", relative)} element={<RotateDistributionCompleteScreen />} />
      <Route path={pathFor("/replace-share", relative)} element={<EnterReplacePackageScreen />} />
      <Route path={pathFor("/replace-share/applying", relative)} element={<ApplyingReplacementScreen />} />
      <Route path={pathFor("/replace-share/failed", relative)} element={<ReplacementFailedScreen />} />
      <Route path={pathFor("/replace-share/replaced", relative)} element={<ShareReplacedScreen />} />
      <Route path={pathFor("/recover/:profileId", relative)} element={<CollectSharesScreen />} />
      <Route path={pathFor("/recover/:profileId/success", relative)} element={<RecoverSuccessScreen />} />
      <Route path={pathFor("/dashboard/:profileId", relative)} element={<DashboardScreen />} />
      <Route path="*" element={<Navigate to={relative ? "." : "/"} replace />} />
    </Routes>
  );
}
