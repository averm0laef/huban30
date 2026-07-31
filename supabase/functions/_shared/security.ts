const encoder = new TextEncoder();

export function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export function isAllowedOneCClient(request: Request): boolean {
  const configured = Deno.env.get("ONE_C_ALLOWED_IPS");
  if (!configured) return false;

  const clientIp = getClientIp(request);
  return configured
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
    .includes(clientIp);
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(digest);
}

export async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const [providedDigest, expectedDigest] = await Promise.all([
    sha256(provided),
    sha256(expected),
  ]);

  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }

  return difference === 0;
}
