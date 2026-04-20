import { notFound } from "next/navigation";
import { isOnCallRotationsEnabled } from "@/lib/feature-flags";

export default function OnCallLayout({ children }: { children: React.ReactNode }) {
  if (!isOnCallRotationsEnabled()) {
    notFound();
  }
  return <>{children}</>;
}
