import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ order?: string }>;
}

export default async function OrderFailedRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const order = params.order?.trim();
  if (order) {
    redirect(`/payment/failure?order=${encodeURIComponent(order)}`);
  }
  redirect("/payment/failure");
}
