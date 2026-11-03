import { redirect } from "next/navigation";

export default function LegacyProductPage() {
  redirect("/superadmin/manage-content");
}
