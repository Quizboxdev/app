"use client";

import { use } from "react";
import SetPlayer from "@/components/marketplace/SetPlayer";
import { openFamilySet, recordFamilySet } from "@/lib/api/family";

// Practise a question set a parent gave you. Same player as the Marketplace; the database only opens it while your family's purchase is still active.
export default function FamilySetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SetPlayer id={id} open={openFamilySet} record={recordFamilySet} backHref="/student" backLabel="Home" ownedLine="Available until" />;
}
