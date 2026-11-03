"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FullPageLoader } from "@/app/components/Loader";

/** Integrity was merged into Auth Health — keep old bookmarks working. */
export default function DevIntegrityRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dev/auth-health?section=integrity");
  }, [router]);

  return <FullPageLoader text="Opening Auth Health…" />;
}
