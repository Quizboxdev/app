import type { ReactNode } from "react";
import SchoolProvider from "@/components/SchoolProvider";

export default function SchoolLayout({ children }: { children: ReactNode }) {
  return <SchoolProvider>{children}</SchoolProvider>;
}
