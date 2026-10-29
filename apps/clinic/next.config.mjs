import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prod = process.env.NODE_ENV === "production";

// Security headers on every response. No-referrer matters: OB-GYN summary links carry a token.
const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(prod ? [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  ] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(here, "../../"),
  transpilePackages: ["@kinpath/core", "@kinpath/db"],
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // The phone app, published as web pages for the shared demo (scripts/build-phone-web.sh).
  async rewrites() {
    // Any other /phone path that isn't a file is a screen in the app (Expo Router); the app routes it.
    return [{ source: "/phone", destination: "/phone/index.html" }, { source: "/phone/:path*", destination: "/phone/index.html" }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: security },
      // The phone app may use the camera (snap a meds calendar) and microphone (Say it), and nothing else.
      { source: "/phone/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" }] },
      { source: "/phone", headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" }] },
    ];
  },
};
export default nextConfig;
