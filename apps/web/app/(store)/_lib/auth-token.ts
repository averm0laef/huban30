export interface ConsumedAuthUrl {
  cleanUrl: string;
  token: string;
}

function rawFragmentToken(fragment: string): string {
  if (!fragment || fragment.includes("=")) return "";
  try {
    return decodeURIComponent(fragment);
  } catch {
    return "";
  }
}

export function consumeAuthToken(href: string): ConsumedAuthUrl {
  const url = new URL(href);
  const fragment = url.hash.slice(1);
  const fragmentParams = new URLSearchParams(fragment);
  const fragmentToken = fragmentParams.get("token") || rawFragmentToken(fragment);
  const token = fragmentToken || url.searchParams.get("token") || "";

  url.searchParams.delete("token");
  if (fragmentParams.has("token")) {
    fragmentParams.delete("token");
    url.hash = fragmentParams.toString();
  } else if (rawFragmentToken(fragment)) {
    url.hash = "";
  }

  return {
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
    token: token.slice(0, 256),
  };
}
