"use client";

import { useState } from "react";

// A slim branded header image. If the file has not been added yet it renders nothing, so pages never show a broken image.
export default function BrandBanner({ src, maxHeight = 110 }: { src: string; maxHeight?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
    style={{ display: "block", width: "100%", maxHeight, objectFit: "cover", borderRadius: 12, marginBottom: 14 }} />;
}
