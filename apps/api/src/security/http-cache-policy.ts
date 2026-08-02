export function isPubliclyCacheableApiRequest(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = url.split("?", 1)[0] ?? "";
  return /^\/api\/v1\/catalog\/(?:brands|categories|featured|media\/|products(?:\/|$))/u.test(path)
    || /^\/api\/v1\/public\/(?:banners|content\/|media\/|settings$)/u.test(path);
}
