import { BifrostPackageError } from "../lib/bifrost/packageService";
import { OnboardingRelayError } from "../lib/relay/browserRelayClient";
import { SetupFlowError } from "./AppStateTypes";

export function setupErrorFromPackage(
  error: unknown,
  fallback: { code: SetupFlowError["code"]; message: string; details?: Record<string, unknown> }
): SetupFlowError {
  if (error instanceof SetupFlowError) {
    return error;
  }
  if (error instanceof BifrostPackageError) {
    if (error.code === "wrong_password") {
      return new SetupFlowError("wrong_password", error.message || fallback.message, fallback.details);
    }
    if (error.code === "verification_failed") {
      return new SetupFlowError("onboard_rejected", error.message || "Onboarding source rejected the request.", fallback.details);
    }
    return new SetupFlowError("invalid_package", error.message || fallback.message, fallback.details);
  }
  return new SetupFlowError(
    fallback.code,
    error instanceof Error ? error.message : fallback.message,
    fallback.details
  );
}

export function setupErrorFromOnboardingRelay(error: unknown): SetupFlowError {
  if (error instanceof SetupFlowError) {
    return error;
  }
  if (error instanceof OnboardingRelayError) {
    return new SetupFlowError(error.code, error.message, error.details);
  }
  return new SetupFlowError(
    "invalid_onboard_response",
    error instanceof Error ? error.message : "Unable to complete onboarding handshake."
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function makeAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Onboarding handshake was cancelled.", "AbortError");
  }
  const error = new Error("Onboarding handshake was cancelled.");
  error.name = "AbortError";
  return error;
}
