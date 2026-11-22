import { lookup } from "node:dns/promises";
import { get } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export interface PublicImage { bytes: Uint8Array<ArrayBuffer>; mime: "image/jpeg" | "image/png" | "image/gif"; filename: string }

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a=0,b=0,c=0] = address.split(".").map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6) return false;
  const [first,second="0"] = address.toLowerCase().split(":");
  const prefix = Number.parseInt(first!,16), next = Number.parseInt(second || "0",16);
  // Exclude transition mechanisms, documentation and protocol assignments.
  return prefix >= 0x2000 && prefix <= 0x3fff && prefix !== 0x2002 && !(prefix === 0x2001 && (next <= 0x1ff || next === 0xdb8));
}

function imageKind(bytes: Buffer): Pick<PublicImage,"mime"|"filename"> | null {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mime: "image/png", filename: "post.png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", filename: "post.jpg" };
  if (["GIF87a","GIF89a"].includes(bytes.subarray(0,6).toString("ascii"))) return { mime: "image/gif", filename: "post.gif" };
  return null;
}

/** Resolve once, reject every private answer, pin the chosen address to the
 * TLS request. Redirects are never followed and no credential is forwarded. */
export async function loadPublicImage(value: string, resolver: typeof lookup = lookup, requester: typeof get = get): Promise<PublicImage> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(url.hostname)
    || !url.hostname.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/iu.test(url.hostname)) throw new Error("invalid_image_url");
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    resolver(url.hostname,{ all: true, verbatim: true }),
    new Promise<never>((_resolve,reject)=>{ dnsTimer=setTimeout(()=>reject(new Error("image_dns_timeout")),5_000); dnsTimer.unref(); }),
  ]).finally(()=>clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some(answer=>!isPublicAddress(answer.address))) throw new Error("image_address_not_public");
  const chosen = addresses[0]!;
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null,[chosen]);
    else callback(null,chosen.address,chosen.family);
  };
  const response = await new Promise<import("node:http").IncomingMessage>((resolve,reject)=>{
    const request = requester(url,{ lookup: pinnedLookup, agent: false, signal: AbortSignal.timeout(10_000), headers: { Accept: "image/jpeg,image/png,image/gif" } },resolve);
    request.once("error",reject);
  });
  try {
    if (response.statusCode !== 200 || Number(response.headers["content-length"] ?? 0) > MAX_IMAGE_BYTES) throw new Error("image_download_rejected");
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      length += bytes.length;
      if (length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks), kind = imageKind(bytes);
    if (!kind || (response.headers["content-type"] ?? "").split(";",1)[0]?.toLowerCase() !== kind.mime) throw new Error("image_format_not_supported");
    // Copy into an ordinary ArrayBuffer for standards-compliant Blob bodies.
    return { ...kind, bytes: new Uint8Array(bytes) };
  } finally { response.destroy(); }
}
