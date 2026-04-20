export interface RotateSourceInput {
  packageText: string;
  password: string;
}

export type RotateRouteState = { profileId: string };
export type RotateProductPhase = "sources_validated" | "rotated" | "profile_created" | "distribution_ready";

export interface RotatePhase {
  label: string;
  state: "done" | "active" | "pending";
}
