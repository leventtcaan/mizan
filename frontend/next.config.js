/** @type {import('next').NextConfig} */
const nextConfig = {
  // WHY: output: standalone bundles everything needed to run Next.js without node_modules.
  // Required for production Docker — reduces image from ~1 GB to ~200 MB.
  // Remove for local dev outside Docker if you hit issues.
  output: "standalone",
};

module.exports = nextConfig;
