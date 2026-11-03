"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StaffSetupPasswordRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/super-login");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center px-4 text-sm text-gray-600">
      Please use the verification link from your invitation email to set your password.
    </div>
  );
}
