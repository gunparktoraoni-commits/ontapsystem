/**
 * /dev root — redirects to the Developer Portal overview.
 * No client-side JS needed; Next.js handles the permanent redirect.
 */
import { redirect } from "next/navigation";

export default function DevRootPage() {
  redirect("/dev/overview");
}
