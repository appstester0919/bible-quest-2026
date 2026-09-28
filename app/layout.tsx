import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { Nunito, Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import "./globals.css";
import { isIdentity, type Identity } from "@/lib/identity";

// ─── Self-hosted webfonts (perf batch #5) ────────────────────────────────────
// Previously three render-blocking <link> tags to fonts.googleapis.com in the
// root layout, including the full Traditional-Chinese subsets. next/font
// downloads these at BUILD time, self-hosts them under
// /_next/static/media/, adds <link rel="preload"> for the primary faces, and
// drops them behind unicode-range subsetting so only the ranges actually used
// by the rendered text are fetched. The `variable:` option exposes each family
// as a CSS custom property; app/globals.css maps them into --font-sans /
// --font-serif so every existing `font-family: var(--font-*)` rule and the
// Tailwind `font-sans` utility keep working unchanged.
//
// Weights kept, from an audit of app/globals.css,
// app/(main)/discipline/discipline.css and inline fontWeight in
// app/(main)/read/page.tsx:
//   Nunito      400 (body), 500, 600, 700, 800 (h-section/headings) — and
//               900 (.cal-day-tick), which the old stylesheet link did NOT
//               load and the browser was synthesising. Loaded for real now.
//   Noto Sans TC  400, 500, 700
//   Noto Serif TC 400, 600 (.scripture-text, headings)
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

// Noto Sans/Serif TC: next/font emits the full CJK face broken into ~100
// unicode-range subsets automatically; there is no `chinese-traditional`
// option for these two (the type only allows the Latin/Cyrillic/Vietnamese
// sets), and every subset is a separate woff2 the browser downloads only if it
// hits glyphs in that range — strictly better than the old one-big-link, which
// shipped the same faces but after a cross-origin DNS+TLS+CSS round-trip.
// preload:false is required for them (Next refuses to guess a subset), which
// is correct anyway: a CJK face must not be preloaded, since one woff2 would
// not cover the text and preloading the wrong subset wastes bandwidth.
const notoSansTC = Noto_Sans_TC({
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
  preload: false,
});

const notoSerifTC = Noto_Serif_TC({
  weight: ["400", "600"],
  variable: "--font-noto-serif-tc",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "DuoBible",
  description: "每日讀經，養成習慣。為青少年基督徒而設的讀經計劃應用。",
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

// ─── Force dynamic rendering so the server reads the latest profile.identity
// from Supabase on every request. Without this, Next.js statically generates
// the layout at build time and <body data-identity="Uni"> is baked in forever
// — users who change identity in Settings see no background change.
// Trade-off: every render still hits Supabase's `profiles` table for signed-in
// users, but the identity lookup is now gated on a session cookie, so
// anonymous hits (/login, /signup, /offline, logged-out pages) cost zero
// network round-trips instead of one. ────────────────────────────────────────
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ─── Read user identity (for body[data-identity="..."] bg) ────────────────
  // Server component: read the Supabase session from cookies, then look up
  // profile.identity. If unauthenticated or identity missing/invalid, default
  // to 'Uni' so the existing 爾國臨格 background still shows.
  //
  // The ONLY thing `user` is used for here is its `id` (to key the profiles
  // SELECT). That id is a signed, server-verifiable claim carried in the JWT
  // itself, and the profiles read is an RLS-scoped SELECT — so the extra
  // getUser() network call that verifies the token with Supabase Auth bought
  // us nothing: a forged cookie cannot reach any other user's row, and the
  // worst outcome of a stale/expired cookie is one wrong background variant.
  // getSession() reads and validates the cookie claims locally (it refreshes
  // over the network only when the token is within 10s of expiry), so an
  // anonymous page render makes no Supabase Auth call at all.
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
    // Local cookie read only — no network round-trip for anonymous visitors.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("identity")
        .eq("id", session.user.id)
        .maybeSingle();
      if (profile?.identity && isIdentity(profile.identity)) {
        userIdentity = profile.identity;
      }
    }
  } catch (err) {
    console.error("[layout] failed to read user identity:", err);
    // fall through to default 'Uni'
  }

  return (
    <html
      lang="zh-Hant"
      className={`${nunito.variable} ${notoSansTC.variable} ${notoSerifTC.variable}`}
    >
      <head>
        {/*
          The old render-blocking <link> to
          https://fonts.googleapis.com/css2?family=... is gone. next/font
          self-hosts the faces at build time under /_next/static/media/ and
          injects its own preload + stylesheet links, so there is no
          third-party font request and no extra round-trip on first paint.
        */}
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
