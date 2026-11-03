"use client";

import { useState } from "react";
import { FileText, Shield } from "lucide-react";
import type { LegalPolicyId } from "@/app/lib/legal";
import { LegalPolicyModal } from "./LegalPolicyModal";

type AccountMenuLegalLinksProps = {
  onNavigate?: () => void;
  className?: string;
  /** Include cookie policy link (default false — Terms + Privacy only in account menu). */
  includeCookies?: boolean;
};

/**
 * Terms & Privacy entries for portal avatar menus (between Settings and Logout).
 */
export function AccountMenuLegalLinks({
  onNavigate,
  className = "w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors",
  includeCookies = false,
}: AccountMenuLegalLinksProps) {
  const [policy, setPolicy] = useState<LegalPolicyId | null>(null);

  const open = (id: LegalPolicyId) => {
    setPolicy(id);
  };

  const close = () => {
    setPolicy(null);
    onNavigate?.();
  };

  return (
    <>
      <button type="button" onClick={() => open("terms")} className={className}>
        <FileText className="h-4 w-4 text-[#2A4792]" />
        Terms &amp; Conditions
      </button>
      <button type="button" onClick={() => open("privacy")} className={className}>
        <Shield className="h-4 w-4 text-[#2A4792]" />
        Privacy Policy
      </button>
      {includeCookies ? (
        <button type="button" onClick={() => open("cookies")} className={className}>
          <FileText className="h-4 w-4 text-[#2A4792]" />
          Cookie Policy
        </button>
      ) : null}
      <LegalPolicyModal
        open={Boolean(policy)}
        policy={policy}
        onClose={close}
        onPolicyChange={setPolicy}
      />
    </>
  );
}
