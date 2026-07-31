import type { LoggerService } from "@nestjs/common";

const SENSITIVE_KEY = /(authorization|cookie|csrf|email|ip(address)?|password|phone|secret|token)/iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~-]+/giu;

function redactText(value: string): string {
  return value
    .replace(EMAIL, "[email-redacted]")
    .replace(IPV4, "[ip-redacted]")
    .replace(BEARER, "Bearer [redacted]");
}

export function sanitizeLogValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      message: redactText(value.message),
      name: value.name,
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, "", seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeLogValue(entryValue, entryKey, seen),
    ]),
  );
  seen.delete(value);
  return sanitized;
}

export class StructuredLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write("info", message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write("fatal", message, optionalParams, true);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write("error", message, optionalParams, true);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write("warn", message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write("debug", message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write("trace", message, optionalParams);
  }

  private write(
    level: string,
    message: unknown,
    optionalParams: unknown[],
    stderr = false,
  ): void {
    const record = {
      level,
      time: new Date().toISOString(),
      service: "api",
      message: sanitizeLogValue(message),
      ...(optionalParams.length > 0 ? { context: sanitizeLogValue(optionalParams) } : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    (stderr ? process.stderr : process.stdout).write(line);
  }
}
