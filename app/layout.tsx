import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import "./globals.css";
import { isIdentity, type Identity } from "@/lib/identity";

export const metadata: Metadata = {
  title: "DuoBible",
  description: "每日讀經，養成習慣。為大專基督徒而設的讀經計劃應用。",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DuoBible",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png" }],
    apple: [{ url: "/icons/icon-192.png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#58CC02",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ─── Read user identity (for body[data-identity="..."] bg) ────────────────
  // Server component: read Supabase session via cookies, look up profile.identity.
  // If unauthenticated or identity missing/invalid, default to 'Uni' so the
  // existing 爾國臨格 background still shows.
  let userIdentity: Identity = "Uni";
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() { /* no-op in root layout (RSC can't set cookies) */ },
        },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("identity")
        .eq("id", user.id)
        .single();
      if (profile?.identity && isIdentity(profile.identity)) {
        userIdentity = profile.identity;
      }
    }
  } catch {
    // Anonymous / network blip — fall through to default 'Uni'
  }

  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body data-identity={userIdentity}>
        {children}
        {/* Service worker registration — register immediately for PWA push support */}
<script
  id="register-sw"
  dangerouslySetInnerHTML={{
    __html: `if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('[SW] registered, scope:', reg.scope);
      }).catch(err =>
        console.error('[SW] registration failed:', err)
      );
    }`,
  }}
/>
      </body>
    </html>
  );
}
