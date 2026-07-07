import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated app surfaces have no SEO value and shouldn't be crawled.
      disallow: [
        "/home", "/transactions", "/networth", "/cashflow", "/recurring",
        "/progress", "/reports", "/simulator", "/settings", "/admin",
        "/upload", "/review", "/brief", "/onboarding", "/upgrade", "/verify",
        "/reset-password",
      ],
    },
    sitemap: "https://clarifin.xyz/sitemap.xml",
  };
}
