import type { Metadata } from "next";

// The page is a client component, so its tab title is set here (audit UX-002).
export const metadata: Metadata = { title: "Forgot password | QuizBox" };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
