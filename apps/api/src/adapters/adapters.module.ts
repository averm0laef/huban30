import { Global, Module } from "@nestjs/common";

import {
  AI_PROVIDER,
  NOTIFICATION_PROVIDER,
  SOCIAL_AUTH_PROVIDER,
  STORAGE_PROVIDER,
  SUPPLIER_PROVIDER,
} from "./provider-contracts.js";
import {
  DisabledAiProvider,
  DisabledNotificationProvider,
  DisabledSocialAuthProvider,
  DisabledSupplierProvider,
} from "./disabled.providers.js";
import { GeminiAiProvider } from "./gemini-ai.provider.js";
import { LocalStorageProvider } from "./local-storage.provider.js";
import { RosskoSupplierProvider } from "./rossko/rossko-supplier.provider.js";

@Global()
@Module({
  exports: [AI_PROVIDER, NOTIFICATION_PROVIDER, SOCIAL_AUTH_PROVIDER, STORAGE_PROVIDER, SUPPLIER_PROVIDER],
  providers: [
    DisabledAiProvider,
    DisabledNotificationProvider,
    DisabledSocialAuthProvider,
    DisabledSupplierProvider,
    GeminiAiProvider,
    LocalStorageProvider,
    RosskoSupplierProvider,
    {
      provide: AI_PROVIDER,
      // ADR-004: the shop and chat must stay fully functional with AI off.
      // GeminiAiProvider derives `enabled` from AI_ENABLED itself, so this
      // factory only decides which implementation callers see — the
      // disabled path never builds a request or needs a Gemini key.
      useFactory: (gemini: GeminiAiProvider, disabled: DisabledAiProvider) => (
        gemini.enabled ? gemini : disabled
      ),
      inject: [GeminiAiProvider, DisabledAiProvider],
    },
    { provide: NOTIFICATION_PROVIDER, useExisting: DisabledNotificationProvider },
    { provide: SOCIAL_AUTH_PROVIDER, useExisting: DisabledSocialAuthProvider },
    { provide: STORAGE_PROVIDER, useExisting: LocalStorageProvider },
    {
      provide: SUPPLIER_PROVIDER,
      // ADR-004: the shop must stay fully functional with the integration
      // off. RosskoSupplierProvider derives `enabled` from ROSSKO_ENABLED
      // itself, so this factory only decides which implementation callers
      // see — the disabled path never builds a request or needs credentials.
      useFactory: (rossko: RosskoSupplierProvider, disabled: DisabledSupplierProvider) => (
        rossko.enabled ? rossko : disabled
      ),
      inject: [RosskoSupplierProvider, DisabledSupplierProvider],
    },
  ],
})
export class AdaptersModule {}

