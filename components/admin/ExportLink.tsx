import Link from "next/link";
import { Download } from "lucide-react";

// "Export data" button for the top of an admin screen. It opens the export screen with this screen's data already chosen, ready to pick dates and a category.
export default function ExportLink({ dataset, label = "Export data" }: { dataset: string; label?: string }) {
  return <Link className="qb-btn secondary" href={`/admin/exports?dataset=${encodeURIComponent(dataset)}`} style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}><Download size={16} aria-hidden="true" />{label}</Link>;
}
