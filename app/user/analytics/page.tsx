import { redirect } from "next/navigation";

/** Analytics page removed from the user portal — send users to BizCard list/dashboard. */
export default function UserAnalyticsRedirectPage() {
  redirect("/user/bizcard-list");
}
