import { Global, Module } from "@nestjs/common";

import { AuditService } from "./audit.service.js";
import { CryptoService } from "./crypto.service.js";
import { MalwareScannerService } from "./malware-scanner.service.js";
import { MediaValidationService } from "./media-validation.service.js";
import { PasswordService } from "./password.service.js";
import { RateLimitService } from "./rate-limit.service.js";
import { TotpService } from "./totp.service.js";

@Global()
@Module({
  exports: [
    AuditService,
    CryptoService,
    MalwareScannerService,
    MediaValidationService,
    PasswordService,
    RateLimitService,
    TotpService,
  ],
  providers: [
    AuditService,
    CryptoService,
    MalwareScannerService,
    MediaValidationService,
    PasswordService,
    RateLimitService,
    TotpService,
  ],
})
export class SecurityModule {}
