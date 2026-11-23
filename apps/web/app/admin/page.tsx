import type { Metadata } from "next";

import { StaffWorkspace } from "./staff-workspace";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Сводка — рабочее место" };

export default function AdminPage() {
  return <StaffWorkspace initialSection="overview" />;
}
