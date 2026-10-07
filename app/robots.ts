import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/login", "/onboarding", "/account", "/admin", "/competition", "/learn", "/marketplace", "/notifications", "/practise", "/review", "/school", "/seller", "/sponsor", "/student", "/teacher", "/tenant"],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
