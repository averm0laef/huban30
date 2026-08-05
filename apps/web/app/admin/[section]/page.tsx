import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isStaffSection } from "../sections";
import { StaffWorkspace } from "../staff-workspace";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Рабочее место" };

export default async function StaffSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  // The section list is read from a plain module: importing it from the
  // client component hands the server a reference proxy, not the array.
  if (!isStaffSection(section)) notFound();
  return <StaffWorkspace initialSection={section} />;
}
