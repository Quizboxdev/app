"use client";

import { useState } from "react";
import { subjectHue, subjectInitial, subjectLogoPath, subjectSlug } from "@/lib/brand/subjects";

// Small branded subject logo (40px by default). Uses /brand/subjects/<slug>.webp when the file exists; otherwise a coloured letter tile in
// the same rounded-square shape, so pages look finished before every logo has been generated.
export default function SubjectIcon({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const slug = subjectSlug(name);
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.26), flex: "0 0 auto" } as const;
  if (slug && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={subjectLogoPath(slug)} alt="" width={size} height={size} loading="lazy" decoding="async" style={box} onError={() => setBroken(true)} />;
  }
  const hue = subjectHue(name);
  return <span aria-hidden="true" style={{ ...box, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: Math.round(size * 0.5),
    color: `hsl(${hue} 60% 28%)`, background: `hsl(${hue} 80% 92%)`, border: `1px solid hsl(${hue} 60% 80%)` }}>{subjectInitial(name)}</span>;
}
