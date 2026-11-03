import { notFound, permanentRedirect } from "next/navigation";
import { isLikelyPhysicalSerialSlug } from "@/lib/bizcard/serial-id-format";
import { resolveSerialCanonicalAlias } from "@/lib/bizcard/scan-routing";
import AliasPageClient from "./AliasPageClient";

export const revalidate = 0;

export default async function Page({
  params,
}: {
  params: Promise<{ alias: string }>;
}) {
  const resolvedParams = await params;
  const alias = resolvedParams.alias.trim();

  let serialInPlace = false;

  if (isLikelyPhysicalSerialSlug(alias)) {
    const resolution = await resolveSerialCanonicalAlias(alias);

    if (resolution.outcome === "redirect") {
      // Must be outside try/catch so NEXT_REDIRECT is not swallowed.
      permanentRedirect(`/${encodeURIComponent(resolution.alias)}`);
    }

    if (resolution.outcome === "not_found") {
      notFound();
    }

    if (resolution.outcome === "render_in_place") {
      serialInPlace = true;
    }
    // "defer" falls through to the existing client scan/claim flow.
  }

  return (
    <AliasPageClient
      params={Promise.resolve({ alias })}
      serialInPlace={serialInPlace}
    />
  );
}
