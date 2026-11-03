"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Link2,
  QrCode,
  UserRound,
  X,
} from "lucide-react";
import { ModalPortal } from "@/app/components/ModalPortal";
import { getFrontendApiBaseUrl } from "@/app/components/apiBase";
import { buildImpersonationHeaders } from "@/app/lib/superadminImpersonationHandoff";
import {
  hasVirtualBizCardWithoutSerial,
  PHYSICAL_CARD_HELP_DISABLED_PREFIX,
  PHYSICAL_CARD_HELP_ELIGIBLE_PREFIX,
  PHYSICAL_CARD_HELP_PENDING_PREFIX,
  physicalCardHelpStorageKey,
} from "@/lib/bizcard/physical-card-help";

type HelpMode = "merge" | "separate";

type GuideStep = {
  title: string;
  description: string;
  icon: typeof CreditCard;
};

const GUIDE_STEPS: Record<HelpMode, GuideStep[]> = {
  merge: [
    {
      title: "Make sure your virtual BizCard is ready",
      description:
        "Sign in to the OnTap account that owns the virtual BizCard you want to keep. Check its name and details before linking another card.",
      icon: UserRound,
    },
    {
      title: "Scan the physical BizCard",
      description:
        "Use your phone camera to scan the QR code printed on the physical BizCard. OnTap will check the card and show the available next step.",
      icon: QrCode,
    },
    {
      title: "Choose the virtual card to link",
      description:
        "Select Merge when asked, then choose the correct virtual BizCard. Review the card owner and profile before confirming so the physical card is linked to the right record.",
      icon: Link2,
    },
    {
      title: "Confirm and verify",
      description:
        "After the merge completes, open the BizCard and confirm that its physical-card serial is linked. The virtual profile remains the record you edit and share.",
      icon: BadgeCheck,
    },
  ],
  separate: [
    {
      title: "Scan the physical BizCard",
      description:
        "Use your phone camera to scan its QR code and sign in to the account where you want the new BizCard record.",
      icon: QrCode,
    },
    {
      title: "Choose a separate card",
      description:
        "When OnTap offers a merge, choose Create a separate BizCard or the separate-registration option. This keeps the new physical card independent from your existing virtual card.",
      icon: CreditCard,
    },
    {
      title: "Enter and review its details",
      description:
        "Complete the requested profile information for this card. Check the owner and contact details carefully; these fields belong to the new record, not your existing BizCard.",
      icon: UserRound,
    },
    {
      title: "Save and check the new record",
      description:
        "Finish registration, then open My BizCards to confirm the new card appears separately. Open its preview to verify the details before sharing it.",
      icon: BadgeCheck,
    },
  ],
};

function resolveAccountKeys(provided?: string): string[] {
  const keys = [provided?.trim() ?? ""];
  try {
    const raw = window.localStorage.getItem("authUser");
    const user = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    keys.push(
      String(user.id ?? user.user_id ?? "").trim(),
      String(user.email ?? "").trim(),
    );
  } catch {
    // Continue with the session identifier when cached identity is unavailable.
  }
  return [...new Set(keys.filter(Boolean))];
}

function getGuideStorageKey(prefix: string, accountKey: string): string {
  return physicalCardHelpStorageKey(prefix, accountKey);
}

export function PhysicalBizCardHelpButton({
  accountKey,
  autoCheck = false,
}: {
  accountKey?: string;
  autoCheck?: boolean;
}) {
  const API = getFrontendApiBaseUrl();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<HelpMode>("merge");
  const [step, setStep] = useState(0);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [loading, setLoading] = useState(autoCheck);
  const [requestComplete, setRequestComplete] = useState(!autoCheck);

  const close = useCallback(() => {
    if (doNotShowAgain) {
      const identities = resolveAccountKeys(accountKey);
      if (identities.length > 0) {
        try {
          for (const identity of identities) {
            localStorage.setItem(
              getGuideStorageKey(PHYSICAL_CARD_HELP_DISABLED_PREFIX, identity),
              "1",
            );
            localStorage.removeItem(
              getGuideStorageKey(PHYSICAL_CARD_HELP_ELIGIBLE_PREFIX, identity),
            );
            localStorage.removeItem(
              getGuideStorageKey(PHYSICAL_CARD_HELP_PENDING_PREFIX, identity),
            );
          }
        } catch (error) {
          console.error("Unable to save BizCard tutorial preference:", error);
        }
      }
    }
    setOpen(false);
    setStep(0);
  }, [accountKey, doNotShowAgain]);

  useEffect(() => {
    if (!autoCheck || typeof window === "undefined") {
      setLoading(false);
      setRequestComplete(true);
      return;
    }

    const identities = resolveAccountKeys(accountKey);
    if (identities.length === 0) {
      setLoading(false);
      setRequestComplete(true);
      return;
    }

    const pendingKeys = identities.map((identity) =>
      getGuideStorageKey(PHYSICAL_CARD_HELP_PENDING_PREFIX, identity),
    );
    const eligibleKeys = identities.map((identity) =>
      getGuideStorageKey(PHYSICAL_CARD_HELP_ELIGIBLE_PREFIX, identity),
    );
    let candidate = false;
    try {
      candidate =
        !identities.some(
          (identity) =>
            localStorage.getItem(
              getGuideStorageKey(PHYSICAL_CARD_HELP_DISABLED_PREFIX, identity),
            ) === "1",
        ) &&
        [...pendingKeys, ...eligibleKeys].some(
          (key) => localStorage.getItem(key) === "1",
        );
    } catch (error) {
      console.error("Unable to read BizCard tutorial preference:", error);
    }
    if (!candidate) {
      setLoading(false);
      setRequestComplete(true);
      return;
    }

    let cancelled = false;
    const checkVirtualCards = async () => {
      try {
        const response = await fetch(
          `${API}/api/user/bizcards?page=1&limit=100&sortBy=created_at&sortDir=desc`,
          {
            credentials: "include",
            cache: "no-store",
            headers: buildImpersonationHeaders(),
          },
        );
        if (!response.ok) {
          throw new Error(`BizCard lookup failed (${response.status})`);
        }
        const payload = await response.json();
        const cards = Array.isArray(payload?.data?.bizcards)
          ? payload.data.bizcards
          : Array.isArray(payload?.bizcards)
            ? payload.bizcards
            : [];
        if (cancelled) return;

        if (hasVirtualBizCardWithoutSerial(cards)) {
          for (const key of eligibleKeys) localStorage.setItem(key, "1");
          for (const key of pendingKeys) localStorage.removeItem(key);
          setOpen(true);
        } else {
          for (const key of [...pendingKeys, ...eligibleKeys]) localStorage.removeItem(key);
        }
      } catch (error) {
        console.error("Unable to check virtual BizCards for the tutorial:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRequestComplete(true);
        }
      }
    };
    void checkVirtualCards();
    return () => {
      cancelled = true;
    };
  }, [API, accountKey, autoCheck]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  const steps = GUIDE_STEPS[mode];
  const currentStep = steps[step]!;
  const StepIcon = currentStep.icon;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMode("merge");
          setStep(0);
          setDoNotShowAgain(false);
          setOpen(true);
        }}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-[#EEF2FA] hover:text-[#2A4792] focus:outline-none focus:ring-2 focus:ring-[#2A4792]/30"
        aria-label="Physical BizCard help"
        title="Physical BizCard help"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      {!requestComplete || loading ? null : (
        <ModalPortal isOpen={open} onClose={close}>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.2 }}
              >
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="physical-bizcard-help-title"
                  className="my-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[42rem] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl bg-white shadow-2xl scrollbar-none touch-pan-y"
                >
                  <div className="bg-gradient-to-r from-[#162666] to-[#4785B8] px-5 py-5 text-white sm:px-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">
                          Physical BizCard guide
                        </p>
                        <h2 id="physical-bizcard-help-title" className="mt-1 break-words text-xl font-bold sm:text-2xl">
                          Connect your physical card
                        </h2>
                        <p className="mt-1 text-sm text-white/85">
                          Follow the steps to merge it with a virtual BizCard or register it separately.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={close}
                        className="shrink-0 rounded-full p-2 text-white/85 transition hover:bg-white/15 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60"
                        aria-label="Close BizCard guide"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="p-5 sm:p-7">
                    <div className="grid min-w-0 grid-cols-2 gap-2 rounded-xl bg-[#F4F7FC] p-1">
                      {(["merge", "separate"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setMode(option);
                            setStep(0);
                          }}
                          className={`min-h-11 min-w-0 break-words rounded-lg px-2 py-2 text-sm font-semibold transition sm:px-3 ${
                            mode === option
                              ? "bg-white text-[#2A4792] shadow-sm"
                              : "text-gray-600 hover:text-gray-900"
                          }`}
                          aria-pressed={mode === option}
                        >
                          {option === "merge" ? "Merge with a virtual card" : "Register separately"}
                        </button>
                      ))}
                    </div>

                    <div className="mt-6 grid min-h-52 min-w-0 grid-cols-1 items-center gap-5 sm:grid-cols-[180px_1fr]">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={`${mode}-${step}`}
                          className="flex h-40 items-center justify-center rounded-2xl bg-[#EEF2FA] text-[#2A4792] sm:h-44"
                          initial={{ opacity: 0, scale: 0.94, y: 6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96, y: -4 }}
                          transition={{ duration: 0.18 }}
                          aria-hidden="true"
                        >
                          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-sm ring-8 ring-white/50">
                            <StepIcon className="h-12 w-12" strokeWidth={1.6} />
                          </div>
                        </motion.div>
                      </AnimatePresence>

                      <AnimatePresence mode="wait">
                        <motion.div
                          key={`${mode}-${step}-copy`}
                          className="min-w-0"
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          transition={{ duration: 0.16 }}
                        >
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#4785B8]">
                            Step {step + 1} of {steps.length}
                          </p>
                          <h3 className="mt-2 break-words text-lg font-bold text-gray-900">{currentStep.title}</h3>
                          <p className="mt-2 break-words text-sm leading-6 text-gray-600">{currentStep.description}</p>
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <div className="mt-5 flex min-w-0 items-center justify-between gap-2 border-t border-gray-100 pt-4">
                      <button
                        type="button"
                        onClick={() => setStep((value) => Math.max(0, value - 1))}
                        disabled={step === 0}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                      >
                        <ChevronLeft className="h-4 w-4" /> Previous
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
                        {steps.map((item, index) => (
                          <span
                            key={item.title}
                            className={`h-2 rounded-full transition-all ${
                              index === step ? "w-6 bg-[#2A4792]" : "w-2 bg-gray-200"
                            }`}
                          />
                        ))}
                      </div>
                      {step < steps.length - 1 ? (
                        <button
                          type="button"
                          onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}
                          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-[#2A4792] px-3 text-sm font-semibold text-white transition hover:bg-[#1e3474] focus:outline-none focus:ring-2 focus:ring-[#2A4792]/40 sm:px-4"
                        >
                          Next <ChevronRight className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={close}
                          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg bg-[#2A4792] px-3 text-sm font-semibold text-white transition hover:bg-[#1e3474] focus:outline-none focus:ring-2 focus:ring-[#2A4792]/40 sm:px-4"
                        >
                          Done <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <label className="mt-4 flex min-w-0 cursor-pointer items-start gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={doNotShowAgain}
                        onChange={(event) => setDoNotShowAgain(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-[#2A4792] focus:ring-[#2A4792]"
                      />
                      Do not show this again
                    </label>
                  </div>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </ModalPortal>
      )}
    </>
  );
}
