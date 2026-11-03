// app/api/portfolio/resolve/[uri]/route.ts
// ──────────────────────────────────────────────────────────────
// GET /api/portfolio/resolve/[uri] — Secure Public URI Resolver
// ──────────────────────────────────────────────────────────────
// Implements required resolution priority:
//   1) serial_id lookup first (6-character format)
//   2) redirect to custom_uri if available
//   3) fallback to custom_uri lookup when serial not found
//   4) blank card redirect to registration
//
// Use query param `?format=json` to receive JSON instead of a redirect.
// Default behavior is redirect for fast browser handling.
// ──────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { checkRateLimit } from "@/server/lib/rate-limit";
import { getClientIp, resolveRequestSession } from "@/server/lib/auth";
import { buildVCardPublicUrl, generateQRCodeDataUrl } from "@/server/lib/qr";
import { SerialIdService } from "@/lib/services/serialIdService";
import { resolvePhysicalCardScan } from "@/lib/bizcard/scan-routing";

const prismaAny = prisma as any;

// Custom URI regex: lowercase alphanumeric with hyphens, 3-64 chars
const CUSTOM_URI_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

// Serial ID regex: exactly 6 uppercase alphanumeric characters (excluding I,O,0,1)
const SERIAL_ID_REGEX = /^[A-HJ-NP-Z2-9]{6}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uri: string }> }
) {
  const ip = getClientIp(request);

  try {
    const rateCheck = checkRateLimit("bizcard-resolve", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please slow down." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        }
      );
    }

    const { uri } = await params;
    if (!uri) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    const responseAsJson = request.nextUrl.searchParams.get("format") === "json";
    const serialIdService = SerialIdService.getInstance();
    const isValidSerial = serialIdService.validateSerialId(uri);
    const isValidCustomUri = CUSTOM_URI_REGEX.test(uri);

    if (!isValidSerial && !isValidCustomUri) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    // 1) serial_id lookup first (6-character format)
    if (isValidSerial) {
      // Check EmployeeCard table first
      const card = await prisma.employeeCard.findUnique({
        where: { serial_id: uri },
        select: {
          serial_id: true,
          assigned_user_id: true,
          activation_status: true,
        },
      });

      if (card?.assigned_user_id && card.activation_status !== "inactive" && card.activation_status !== "revoked") {
        const bizcard = await prisma.bizcard.findFirst({
          where: {
            user_id: card.assigned_user_id,
            deactivated_flag: false,
            user: {
              is: {
                is_active: true,
              },
            },
          },
          orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
          select: {
            url_alias: true,
            user: {
              select: {
                vcardSetup: {
                  select: {
                    qr_code: true,
                  },
                },
              },
            },
          },
        });

        // 2) redirect to custom_uri if present
        if (bizcard?.url_alias) {
          const canonicalUrl = buildVCardPublicUrl(bizcard.url_alias);
          const qrCode = bizcard.user?.vcardSetup?.qr_code ?? (canonicalUrl ? generateQRCodeDataUrl(canonicalUrl) : null);

          if (responseAsJson) {
            return NextResponse.json({
              resolvedBy: "serial_id",
              serialId: card.serial_id,
              customUri: bizcard.url_alias,
              portfolioUrl: canonicalUrl,
              qrCode,
              shouldRedirect: true,
            });
          }

          if (canonicalUrl) return NextResponse.redirect(canonicalUrl, 308);
          return NextResponse.json({ error: "Portfolio URL is not configured." }, { status: 500 });
        }
      }

      // Check Bizcard table directly for blank/physical cards
      const bizcardBySerial = await prismaAny.bizcard.findFirst({
        where: {
          serial_id: uri,
          deactivated_flag: false,
        },
        select: {
          serial_id: true,
          url_alias: true,
          is_blank: true,
          user_id: true,
          portfolio_url: true,
          qr_code_url: true,
          user: {
            select: {
              is_active: true,
              custom_uri: true,
            },
          },
        },
      });

      if (bizcardBySerial) {
        // Handle blank/unclaimed card — session-aware (signup vs merge vs create-separate)
        if (bizcardBySerial.is_blank && !bizcardBySerial.user_id) {
          let sessionUserId: bigint | null = null;
          try {
            const resolved = await resolveRequestSession(request, { tryRefresh: true });
            sessionUserId = resolved.session ? BigInt(resolved.session.userId) : null;
          } catch {
            sessionUserId = null;
          }

          const scan = await resolvePhysicalCardScan(uri, sessionUserId);
          const redirectUrl = scan.redirectUrl;
          if (!redirectUrl) {
            return NextResponse.json({ error: "Unable to resolve blank card claim path." }, { status: 500 });
          }

          if (responseAsJson) {
            return NextResponse.json({
              resolvedBy: "serial_id",
              serialId: uri,
              requiresRegistration: scan.nextAction === "signup",
              nextAction: scan.nextAction,
              virtualCards: scan.virtualCards,
              redirectUrl,
              shouldRedirect: true,
              message:
                scan.nextAction === "merge_choice"
                  ? "Choose whether to merge this physical card with a virtual BizCard."
                  : scan.nextAction === "manual_register"
                    ? "Create a separate BizCard to claim this physical card."
                    : "This physical card needs to be claimed. Please register or log in.",
            });
          }

          return NextResponse.redirect(
            redirectUrl.startsWith("http") ? redirectUrl : new URL(redirectUrl, request.url),
            307,
          );
        }

        // Card has custom URI - redirect to canonical
        if (bizcardBySerial.url_alias) {
          const canonicalUrl = buildVCardPublicUrl(bizcardBySerial.url_alias);
          const qrCode = bizcardBySerial.qr_code_url ?? (canonicalUrl ? generateQRCodeDataUrl(canonicalUrl) : null);

          if (responseAsJson) {
            return NextResponse.json({
              resolvedBy: "serial_id",
              serialId: uri,
              customUri: bizcardBySerial.url_alias,
              portfolioUrl: canonicalUrl,
              qrCode,
              shouldRedirect: true,
            });
          }

          if (canonicalUrl) return NextResponse.redirect(canonicalUrl, 308);
        }

        // Fallback to portfolio_url
        if (bizcardBySerial.portfolio_url) {
          if (responseAsJson) {
            return NextResponse.json({
              resolvedBy: "serial_id",
              serialId: uri,
              portfolioUrl: bizcardBySerial.portfolio_url,
              qrCode: bizcardBySerial.qr_code_url ?? null,
              shouldRedirect: true,
            });
          }

          return NextResponse.redirect(bizcardBySerial.portfolio_url, 308);
        }
      }
    }

    // 3) fallback to custom_uri lookup when no serial match
    const owner = await prisma.bizcard.findFirst({
      where: {
        url_alias: uri,
        deactivated_flag: false,
        user: {
          is: {
            is_active: true,
          },
        },
      },
      select: {
        url_alias: true,
        user: {
          select: {
            vcardSetup: {
              select: {
                qr_code: true,
              },
            },
          },
        },
      },
    });

    if (!owner) {
      return NextResponse.json({ error: "Portfolio not found." }, { status: 404 });
    }

    const portfolioUrl = owner.url_alias ? buildVCardPublicUrl(owner.url_alias) : null;
    const qrCode = owner.user?.vcardSetup?.qr_code ?? (portfolioUrl ? generateQRCodeDataUrl(portfolioUrl) : null);

    if (responseAsJson) {
      return NextResponse.json({
        resolvedBy: "custom_uri",
        customUri: owner.url_alias,
        portfolioUrl,
        qrCode,
        shouldRedirect: false,
      });
    }

    if (portfolioUrl) {
      return NextResponse.redirect(portfolioUrl, 308);
    }

    return NextResponse.json({ error: "Portfolio URL is not configured." }, { status: 500 });
  } catch (err) {
    console.error("[portfolio/resolve/[uri]] Unhandled error:", err);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}