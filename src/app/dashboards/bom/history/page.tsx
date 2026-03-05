"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BomHistoryPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboards/bom");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-64 text-muted text-sm">
      Redirecting to BOM…
    </div>
  );
}
