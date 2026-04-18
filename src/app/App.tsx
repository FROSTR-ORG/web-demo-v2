import { Navigate, Route, Routes } from "react-router-dom";
import { CreateKeysetScreen } from "../screens/CreateKeysetScreen";
import { CreateProfileScreen } from "../screens/CreateProfileScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { DistributeSharesScreen } from "../screens/DistributeSharesScreen";
import { DistributionCompleteScreen } from "../screens/DistributionCompleteScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<WelcomeScreen />} />
      <Route path="/create" element={<CreateKeysetScreen />} />
      <Route path="/create/profile" element={<CreateProfileScreen />} />
      <Route path="/create/distribute" element={<DistributeSharesScreen />} />
      <Route path="/create/complete" element={<DistributionCompleteScreen />} />
      <Route path="/dashboard/:profileId" element={<DashboardScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

