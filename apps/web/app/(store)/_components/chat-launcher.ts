/**
 * Where the mini-chat is offered on a page.
 *
 * - "floating": the round button in the corner;
 * - "inline": no round button — it would lie on the form the customer is
 *   filling in (it covered the comment field on checkout) — the page shows
 *   its own «Написать в чат» link that opens the same mini-chat;
 * - "off": the page has its own chat (/chat) or is not the storefront (/admin).
 */
export type ChatLauncherPlacement = "floating" | "inline" | "off";

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function chatLauncherPlacement(pathname: string): ChatLauncherPlacement {
  if (under(pathname, "/chat") || under(pathname, "/admin")) return "off";
  if (under(pathname, "/checkout")) return "inline";
  return "floating";
}

/** Fired on `window` by a page's own «Написать в чат» control. */
export const OPEN_CHAT_EVENT = "an30:open-chat";

export function openChatWidget(): void {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
}
