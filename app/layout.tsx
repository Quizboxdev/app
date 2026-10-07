import "katex/dist/katex.min.css";
import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { RECOVERY_REDIRECT_SCRIPT } from "@/lib/recovery-redirect";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  openGraph: { siteName: "QuizBox", url: SITE_URL, type: "website" },
  title: "QuizBox",
  description: "Learn. Practice. Compete.",
  icons: { icon: "/brand/quizbox-icon-96.png", apple: "/brand/quizbox-apple-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* Forwards a password-recovery return that landed on the wrong page, before any Supabase client can spend its one-time code. */}
        <Script id="qb-recovery-redirect" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: RECOVERY_REDIRECT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
