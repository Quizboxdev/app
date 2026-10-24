"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SupportContactForm from "@/components/public/SupportContactForm";

// Reads ?type= in the browser so the Contact page itself can be static and served from the edge cache (audit UX-030).
function WithType() {
  return <SupportContactForm initialType={useSearchParams().get("type") ?? undefined} />;
}

export default function ContactFormWithType() {
  return <Suspense fallback={<SupportContactForm />}><WithType /></Suspense>;
}
