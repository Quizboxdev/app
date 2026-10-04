import { Inter } from "next/font/google";
import "./public.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className={`qbp ${inter.className}`}>{children}</div>;
}
