import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  /* config options here */
};

const withPWA = withPWAInit({
  dest: "public",
  sw: "/next-pwa-sw.js",
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    importScripts: ["/sw.js"],
  },
});

export default withPWA(nextConfig);
