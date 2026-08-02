import type { Metadata } from "next";

import { privatePageMetadata } from "../_lib/seo";
import { ChatClient } from "./chat-client";

export const metadata: Metadata = privatePageMetadata(
  "Чат с магазином",
  "Защищённый чат клиента с магазином автозапчастей АН-30.",
);

export default function ChatPage() {
  return <ChatClient />;
}
