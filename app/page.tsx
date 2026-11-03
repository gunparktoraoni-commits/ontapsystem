import { Suspense } from "react";
import { preload } from "react-dom";
import OnboardingGate from "./components/OnboardingGate";

/**
 * Root entry point ("/")
 *
 * Renders OnboardingGate, which decides in this order:
 *   1. Returning user (localStorage signals)  → LoginUser
 *   2. Live server session                    → redirect to dashboard
 *   3. First-time visitor                     → OnboardingTutorial → /user/signup
 */
function GateFallback() {
  return <div className="min-h-screen bg-[#ECEEF5]" />;
}

export default function Home() {
  // Warm the login LCP image early for returning visitors.
  preload("/loginpageimage.jpg", { as: "image" });

  return (
    <Suspense fallback={<GateFallback />}>
      <OnboardingGate />
    </Suspense>
  );
}
