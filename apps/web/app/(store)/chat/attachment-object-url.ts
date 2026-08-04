/**
 * Owns exactly one `URL.createObjectURL` result at a time for an attachment
 * preview, so create/revoke always pair up 1:1:
 *  - re-issuing for the same key (the attachment id) without an
 *    intervening `revoke()` returns the already-issued URL instead of
 *    creating a second one ("created once per attachment");
 *  - issuing for a *different* key revokes whatever was active first;
 *  - `revoke()` always releases the current URL and is safe to call more
 *    than once (e.g. from a React effect cleanup on unmount).
 *
 * Framework-free on purpose: `ChatAttachmentImage` (attachment-preview.tsx)
 * is the only caller, but keeping this off React lets the pairing itself —
 * not effect timing — be what gets unit-tested (see
 * attachment-object-url.test.ts).
 */
export interface BlobUrlSource {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export class AttachmentObjectUrl {
  private readonly source: BlobUrlSource;
  private activeKey: string | null = null;
  private activeUrl: string | null = null;

  constructor(source: BlobUrlSource = URL) {
    this.source = source;
  }

  /** The currently issued URL, or null if nothing has been issued (or it was revoked). */
  get url(): string | null {
    return this.activeUrl;
  }

  /** Issues an object URL for `blob` under `key`. Safe to call repeatedly with the same key — it will not leak a second URL. */
  issue(key: string, blob: Blob): string {
    if (this.activeKey === key && this.activeUrl) return this.activeUrl;
    this.revoke();
    this.activeUrl = this.source.createObjectURL(blob);
    this.activeKey = key;
    return this.activeUrl;
  }

  /** Revokes the current URL, if any. Idempotent. */
  revoke(): void {
    if (this.activeUrl) this.source.revokeObjectURL(this.activeUrl);
    this.activeUrl = null;
    this.activeKey = null;
  }
}
