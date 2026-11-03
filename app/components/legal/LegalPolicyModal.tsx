"use client";

import { useMemo } from "react";
import { Cookie, FileText, Shield } from "lucide-react";
import { PortalModal } from "@/app/superadmin/components/ui/PortalModal";
import {
  LEGAL_POLICY_META,
  type LegalPolicyId,
} from "@/app/lib/legal";
import { TermsOfServiceContent } from "@/app/lib/legal/termsOfServiceContent";
import { PrivacyPolicyContent } from "@/app/lib/legal/privacyPolicyContent";
import { CookiePolicyContent } from "@/app/lib/legal/cookiePolicyContent";

type LegalPolicyModalProps = {
  open: boolean;
  policy: LegalPolicyId | null;
  onClose: () => void;
  /** Optional: switch between policies without closing. */
  onPolicyChange?: (policy: LegalPolicyId) => void;
};

const POLICY_ICONS: Record<LegalPolicyId, typeof FileText> = {
  terms: FileText,
  privacy: Shield,
  cookies: Cookie,
};

export function LegalPolicyModal({
  open,
  policy,
  onClose,
  onPolicyChange,
}: LegalPolicyModalProps) {
  const active = policy ?? "terms";
  const meta = LEGAL_POLICY_META[active];
  const Icon = POLICY_ICONS[active];

  const body = useMemo(() => {
    if (active === "privacy") return <PrivacyPolicyContent />;
    if (active === "cookies") return <CookiePolicyContent />;
    return <TermsOfServiceContent />;
  }, [active]);

  return (
    <PortalModal
      open={open && Boolean(policy)}
      onClose={onClose}
      title={meta.title}
      description={meta.description}
      size="xl"
      bodyClassName="!p-0"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LEGAL_POLICY_META) as LegalPolicyId[]).map((id) => {
              const ItemIcon = POLICY_ICONS[id];
              const selected = id === active;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onPolicyChange?.(id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected
                      ? "border-[#2A4792] bg-[#EEF2FA] text-[#2A4792]"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <ItemIcon className="h-3.5 w-3.5" />
                  {LEGAL_POLICY_META[id].shortLabel}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#2A4792] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3B569F]"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="max-h-[min(70vh,640px)] overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <div className="mb-4 flex items-center gap-2 text-[#2A4792]">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF2FA]">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{meta.shortLabel}</p>
            <p className="text-xs text-gray-500">OnTap Creatives · Legal</p>
          </div>
        </div>
        {body}
      </div>
    </PortalModal>
  );
}
