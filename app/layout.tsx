import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  manifest: "/manifest.json",
  title: "Chore Tracker",
  description: "A realtime countdown for recurring chores.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Chore Tracker",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
