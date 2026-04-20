import { redirect } from "next/navigation";

/**
 * Legacy redirect shim — the per-role capability editor has been consolidated
 * into the drawer at `/admin/roles?role=<key>`. This shim exists so old
 * bookmarks, links in external docs, or cached navigations continue to work.
 */
export default async function Page({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(`/admin/roles?role=${encodeURIComponent(role)}`);
}
