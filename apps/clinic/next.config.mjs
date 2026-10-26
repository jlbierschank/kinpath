/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@kinpath/core", "@kinpath/db"],
  serverExternalPackages: ["@electric-sql/pglite"],
};
export default nextConfig;
