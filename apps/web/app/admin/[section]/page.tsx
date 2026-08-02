import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { STAFF_SECTIONS, StaffWorkspace, type StaffSection } from "../staff-workspace";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Рабочее место" };

export default async function StaffSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!STAFF_SECTIONS.includes(section as StaffSection)) notFound();
  return <StaffWorkspace initialSection={section as StaffSection} />;
}
