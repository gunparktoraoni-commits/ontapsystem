import type { Metadata } from "next";
import "./feedback.css";

export const metadata: Metadata = {
  title: "Order feedback | OnTap",
  description: "Share your experience with your OnTap order.",
  robots: { index: false, follow: false },
};

export default function FeedbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="feedback-root">{children}</div>
  );
}
