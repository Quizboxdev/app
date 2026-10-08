import AppShell from "@/components/AppShell";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell sponsorEngine={sponsorEngineEnabled(process.env)}>{children}</AppShell>;
}
