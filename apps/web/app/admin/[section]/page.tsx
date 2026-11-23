import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { navigationItem } from "../navigation";
import { isStaffSection } from "../sections";
import { StaffWorkspace } from "../staff-workspace";

// Each section has its own tab title: with several tabs open «Заказы» and «Каталог» are told apart at a glance.
export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return {
    robots: { index: false, follow: false },
    title: isStaffSection(section) ? `${navigationItem(section).label} — рабочее место` : "Рабочее место",
  };
}

export default async function StaffSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  // The section list is read from a plain module: importing it from the
  // client component hands the server a reference proxy, not the array.
  if (!isStaffSection(section)) notFound();
  return <StaffWorkspace initialSection={section} />;
}
