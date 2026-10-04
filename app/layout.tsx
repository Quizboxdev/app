import "katex/dist/katex.min.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "QuizBox",
  description: "Learn. Practice. Compete.",
  icons: { icon: "/brand/quizbox-icon-96.png", apple: "/brand/quizbox-apple-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
