import { describe, expect, it } from "vitest";

import { smtpSender, smtpTransportOptions } from "./notification-providers.js";

const smtp = { enabled: true, from: "shop@an30.ru", fromName: "АН-30", host: "postbox.cloud.yandex.net", password: "secret", port: 587, secure: false, user: "key-id" };

describe("the connection to the mail server", () => {
  it("is always encrypted: STARTTLS is required on port 587, TLS from the first byte on 465", () => {
    expect(smtpTransportOptions(smtp)).toMatchObject({ host: "postbox.cloud.yandex.net", port: 587, requireTLS: true, secure: false });
    expect(smtpTransportOptions({ ...smtp, port: 465, secure: true })).toMatchObject({ port: 465, requireTLS: false, secure: true });
  });

  // nodemailer waits two minutes for a connection and ten for a silent socket by default; one stuck letter would
  // hold the queue of password-recovery letters behind it.
  it("gives up on a server that does not answer, within seconds", () => {
    expect(smtpTransportOptions(smtp)).toMatchObject({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });
  });

  it("never reads a file or a URL into a letter", () => {
    expect(smtpTransportOptions(smtp)).toMatchObject({ disableFileAccess: true, disableUrlAccess: true });
  });

  it("signs in only when a user is configured", () => {
    expect(smtpTransportOptions(smtp).auth).toEqual({ pass: "secret", user: "key-id" });
    expect(smtpTransportOptions({ ...smtp, password: undefined, user: undefined }).auth).toBeUndefined();
  });
});

describe("the sender of a letter", () => {
  it("is the shop by name, at the configured address", () => {
    expect(smtpSender(smtp)).toEqual({ address: "shop@an30.ru", name: "АН-30" });
  });
});
