import { FindingKind } from "./finding";

export type UserRole = "developer" | "support" | "hr" | "finance" | "admin";

export interface PolicyRule {
  id: string;
  name: string;
  appliesToRoles: UserRole[];
  blockKinds: FindingKind[];
  warnKinds: FindingKind[];
  maxRiskScoreAllowed: number;
}

export interface PolicyBundle {
  version: string;
  activePolicyId: string;
  rules: PolicyRule[];
}
