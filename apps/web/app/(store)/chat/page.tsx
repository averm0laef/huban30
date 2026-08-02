import type { Metadata } from "next";

import { ChatClient } from "./chat-client";

export const metadata: Metadata = {
  title: "Чат с магазином",
  description: "Защищённый чат клиента с магазином автозапчастей АН-30.",
};

export default function ChatPage() {
  return <ChatClient />;
}
