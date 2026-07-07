import type { MetadataRoute } from "next";

// Public, indexable pages only — the app itself is behind auth.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://clarifin.xyz";
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
