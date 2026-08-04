import { describe, expect, it, vi } from "vitest";

import { AttachmentObjectUrl } from "./attachment-object-url";

function fakeSource() {
  let counter = 0;
  return {
    createObjectURL: vi.fn(() => `blob:fake-${counter++}`),
    revokeObjectURL: vi.fn(),
  };
}

describe("AttachmentObjectUrl", () => {
  it("creates exactly one object URL per attachment (repeat issues for the same key are free)", () => {
    const source = fakeSource();
    const handle = new AttachmentObjectUrl(source);
    const blob = new Blob(["a"]);
    const first = handle.issue("attachment-1", blob);
    const second = handle.issue("attachment-1", blob);
    const third = handle.issue("attachment-1", blob);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(source.createObjectURL).toHaveBeenCalledTimes(1);
    expect(source.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("revokes the previous URL before issuing a new one for a different attachment", () => {
    const source = fakeSource();
    const handle = new AttachmentObjectUrl(source);
    const first = handle.issue("attachment-1", new Blob(["a"]));
    const second = handle.issue("attachment-2", new Blob(["b"]));
    expect(second).not.toBe(first);
    expect(source.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(source.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(handle.url).toBe(second);
  });

  it("revokes on teardown and never double-revokes", () => {
    const source = fakeSource();
    const handle = new AttachmentObjectUrl(source);
    const first = handle.issue("attachment-1", new Blob(["a"]));
    handle.revoke();
    handle.revoke();
    expect(source.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(source.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(handle.url).toBeNull();
  });

  it("is safe to revoke before anything was ever issued", () => {
    const source = fakeSource();
    const handle = new AttachmentObjectUrl(source);
    expect(() => handle.revoke()).not.toThrow();
    expect(source.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("issues a fresh URL for the same attachment id after an explicit revoke, without leaking the old one", () => {
    const source = fakeSource();
    const handle = new AttachmentObjectUrl(source);
    const first = handle.issue("attachment-1", new Blob(["a"]));
    handle.revoke();
    const second = handle.issue("attachment-1", new Blob(["a"]));
    expect(second).not.toBe(first);
    expect(source.createObjectURL).toHaveBeenCalledTimes(2);
    expect(source.revokeObjectURL).toHaveBeenCalledWith(first);
  });
});
