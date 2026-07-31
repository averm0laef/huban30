type LogLevel = "info" | "error";

export function log(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: "database",
    event,
    ...details,
  });

  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${entry}\n`);
}
