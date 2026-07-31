import type { Role } from "@an30/contracts";

export interface AuthContext {
  csrfTokenHash: Buffer;
  email: string;
  mfaSetupRequired: boolean;
  mfaVerified: boolean;
  role: Role;
  sessionId: string;
  userId: string;
}
