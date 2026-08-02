import { Global, Module } from "@nestjs/common";

import {
  AI_PROVIDER,
  NOTIFICATION_PROVIDER,
  SOCIAL_AUTH_PROVIDER,
  STORAGE_PROVIDER,
} from "./provider-contracts.js";
import {
  DisabledAiProvider,
  DisabledNotificationProvider,
  DisabledSocialAuthProvider,
} from "./disabled.providers.js";
import { LocalStorageProvider } from "./local-storage.provider.js";

@Global()
@Module({
  exports: [AI_PROVIDER, NOTIFICATION_PROVIDER, SOCIAL_AUTH_PROVIDER, STORAGE_PROVIDER],
  providers: [
    DisabledAiProvider,
    DisabledNotificationProvider,
    DisabledSocialAuthProvider,
    LocalStorageProvider,
    { provide: AI_PROVIDER, useExisting: DisabledAiProvider },
    { provide: NOTIFICATION_PROVIDER, useExisting: DisabledNotificationProvider },
    { provide: SOCIAL_AUTH_PROVIDER, useExisting: DisabledSocialAuthProvider },
    { provide: STORAGE_PROVIDER, useExisting: LocalStorageProvider },
  ],
})
export class AdaptersModule {}

