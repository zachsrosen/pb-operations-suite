import { redirect } from "next/navigation";

// Consolidated into the tabbed PE hub — kept as a redirect so bookmarks,
// suite cards, and role allowlists keep working.
export default function Page() {
  redirect("/dashboards/pe?tab=docs");
}
