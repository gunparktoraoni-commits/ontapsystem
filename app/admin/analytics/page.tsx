import { redirect } from "next/navigation";

/** Analytics page removed from the admin portal — send admins to BizCard list/dashboard. */
export default function AdminAnalyticsRedirectPage() {
  redirect("/admin/bizcard-list");
}
