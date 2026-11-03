import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ order?: string }>;
}

export default async function OrderSuccessRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const order = params.order?.trim();
  if (order) {
    redirect(`/payment/success?order=${encodeURIComponent(order)}`);
  }
  redirect("/payment/success");
}
