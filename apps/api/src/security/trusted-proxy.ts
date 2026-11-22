import { isIP } from "node:net";

export function trustedProxyRanges(environment: NodeJS.ProcessEnv): false | string[] {
  if (environment.TRUST_PROXY_HOPS && environment.TRUST_PROXY_HOPS !== "0") {
    throw new Error("TRUST_PROXY_HOPS is unsupported; configure TRUST_PROXY_CIDRS with proxy addresses");
  }
  const ranges = (environment.TRUST_PROXY_CIDRS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const range of ranges) {
    const [address, prefix, extra] = range.split("/");
    const family = address ? isIP(address) : 0;
    if (!family || extra !== undefined || (prefix !== undefined && (
      !/^\d{1,3}$/u.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)
    ))) {
      throw new Error("TRUST_PROXY_CIDRS must contain only IP addresses or CIDR networks");
    }
  }
  return ranges.length > 0 ? ranges : false;
}
