import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { snapshotFromAppState, writeBridgeSnapshot } from "./appStateBridge";
import { AppStateContext } from "./AppStateContext";
import type { AppStateValue } from "./AppStateTypes";

export function MockAppStateProvider({
  value,
  children,
  bridge = true
}: {
  value: AppStateValue;
  children: ReactNode;
  /**
   * When true (default), the mock provider writes a sessionStorage bridge
   * snapshot on mount and whenever its internal state changes, so the real
   * AppStateProvider can rehydrate if the user navigates out of `/demo/*`
   * into a real application route like `/dashboard/:id`. Pass `false` in
   * isolated test setups where the bridge would be noise.
   */
  bridge?: boolean;
}) {
  // MockAppStateProvider owns its own bridge-serialisable fields so that
  // mutators like `clearCredentials` and `lockProfile` can truly update the
  // visible state from inside the demo shell (e.g. clearing profiles before
  // a navigate("/") hand-off to the real AppStateProvider). The `value` prop
  // supplies the initial seed and all non-state callbacks; internal setters
  // override the mutators that must participate in demo-side state changes.
  const [profiles, setProfiles] = useState(value.profiles);
  const [activeProfile, setActiveProfile] = useState(value.activeProfile);
  const [runtimeStatus, setRuntimeStatus] = useState(value.runtimeStatus);
  const [signerPaused, setSignerPausedState] = useState(value.signerPaused);
  const [createSession, setCreateSession] = useState(value.createSession);
  const [importSession, setImportSession] = useState(value.importSession);
  const [onboardSession, setOnboardSession] = useState(value.onboardSession);
  const [rotateKeysetSession, setRotateKeysetSession] = useState(value.rotateKeysetSession);
  const [recoverSession, setRecoverSession] = useState(value.recoverSession);

  const lockProfile = useCallback(() => {
    // Forward to any caller-supplied behaviour first (fixtures may observe).
    value.lockProfile();
	    setRuntimeStatus(null);
	    setActiveProfile(null);
	    setSignerPausedState(false);
	    setCreateSession(null);
	    setImportSession(null);
	    setOnboardSession(null);
	    setRotateKeysetSession(null);
	    setRecoverSession(null);
	  }, [value]);

  const clearCredentials = useCallback(async () => {
    await value.clearCredentials();
    setProfiles([]);
    setActiveProfile(null);
    setRuntimeStatus(null);
    setSignerPausedState(false);
    setCreateSession(null);
    setImportSession(null);
    setOnboardSession(null);
    setRotateKeysetSession(null);
    setRecoverSession(null);
  }, [value]);

  const setSignerPaused = useCallback(
    (paused: boolean) => {
      value.setSignerPaused(paused);
      setSignerPausedState(paused);
    },
    [value]
  );

  const stateful = useMemo<AppStateValue>(
    () => ({
      ...value,
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      recoverSession,
      lockProfile,
      clearCredentials,
      setSignerPaused
    }),
    [
      value,
      profiles,
      activeProfile,
      runtimeStatus,
      signerPaused,
      createSession,
      importSession,
      onboardSession,
      rotateKeysetSession,
      recoverSession,
      lockProfile,
      clearCredentials,
      setSignerPaused
    ]
  );

  useEffect(() => {
    if (!bridge) return;
    writeBridgeSnapshot(snapshotFromAppState(stateful));
  }, [stateful, bridge]);

  return <AppStateContext.Provider value={stateful}>{children}</AppStateContext.Provider>;
}
