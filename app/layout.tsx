import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bible Quest 2026",
  description: "Duolingo-inspired Bible reading app for young Christians.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
