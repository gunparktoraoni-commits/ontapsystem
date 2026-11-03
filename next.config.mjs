// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  ...(process.env.HOSTINGER_BUILD === "1" && {
    experimental: {
      // Keep constrained shared-host builds from exhausting the process thread limit.
      cpus: 1,
    },
  }),
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "f86d5ef2527c0628f724488a7c353eb2.r2.cloudflarestorage.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "portal.ontap.ph",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.portal.ontap.ph",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "placehold.co",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3001",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "/**",
      },
    ],
  },

  turbopack: {
    root: process.cwd(),
  },

  async redirects() {
    return [
      {
        source: "/public/:alias",
        destination: "/:alias",
        permanent: false,
      },
      {
        source: "/serial/:serialId",
        destination: "/:serialId",
        permanent: false,
      },
      {
        source: "/frontend/user/:path*",
        destination: "/user/:path*",
        permanent: true,
      },
      {
        source: "/frontend/admin/:path*",
        destination: "/admin/:path*",
        permanent: true,
      },
      {
        source: "/frontend/user",
        destination: "/user/dashboard",
        permanent: true,
      },
      {
        source: "/frontend/admin",
        destination: "/admin/dashboard",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source:
          "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot|txt|xml)$).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },

      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },

      {
        source: "/:all*(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },

      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },

      {
        source: "/api/public/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },

      {
        source: "/api/vcard/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },

  // Keep Prisma clients external so Next does not strip native query-engine binaries.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/analytics-client",
    "bcryptjs",
    "cloudinary",
    "qrcode",
    "pngjs",
  ],
};

export default nextConfig;
