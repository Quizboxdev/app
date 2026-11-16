"use client";

import { use } from "react";
import SetPlayer from "@/components/marketplace/SetPlayer";
import { openSet, recordAttempt } from "@/lib/api/marketplace";

// Practise a purchased set (the player is shared with sets a family gives a child; see components/marketplace/SetPlayer.tsx).
export default function PlaySet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SetPlayer id={id} open={openSet} record={recordAttempt} backHref="/marketplace/mine" backLabel="My question sets" />;
}
