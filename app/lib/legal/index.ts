export type LegalPolicyId = "terms" | "privacy" | "cookies";

export const LEGAL_POLICY_META: Record<
  LegalPolicyId,
  { title: string; shortLabel: string; description: string }
> = {
  terms: {
    title: "Terms of Service",
    shortLabel: "Terms & Conditions",
    description: "Rules for using OnTap products and services.",
  },
  privacy: {
    title: "Privacy Policy",
    shortLabel: "Privacy Policy",
    description: "How we collect, use, and protect your information.",
  },
  cookies: {
    title: "Cookie Policy",
    shortLabel: "Cookie Policy",
    description: "How cookies and similar technologies are used.",
  },
};
