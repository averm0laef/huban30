import { SetMetadata } from "@nestjs/common";

import type { Permission } from "@an30/contracts";

export const PUBLIC_ROUTE_KEY = "an30:public-route";
export const PENDING_MFA_KEY = "an30:pending-mfa";
export const PERMISSIONS_KEY = "an30:permissions";
export const SKIP_CSRF_KEY = "an30:skip-csrf";

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const AllowPendingMfa = () => SetMetadata(PENDING_MFA_KEY, true);
export const RequirePermissions = (...permissions: Permission[]) => (
  SetMetadata(PERMISSIONS_KEY, permissions)
);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
