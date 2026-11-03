"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StaffVerifyEmailRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/super-login");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center px-4 text-sm text-gray-600">
      Staff accounts are verified using the link in your invitation email.
    </div>
  );
}
