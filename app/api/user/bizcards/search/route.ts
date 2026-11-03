import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { getClientIp } from "@/server/lib/auth";
import { checkRateLimit } from "@/server/lib/rate-limit";
import {
  buildHighlight,
  computeSimpleMatchScore,
  parseBizcardSearchParams,
} from "@/lib/bizcard/validation";
import { withPerformanceTracking } from "@/middleware/performance";
import { requireSession, serialize } from "../_helpers";

export async function GET(request: NextRequest) {
  return withPerformanceTracking(request, async () => {
    const ip = getClientIp(request);
    const rateCheck = checkRateLimit("user-bizcards-search", ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please slow down." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) } }
      );
    }

    const auth = await requireSession(request);
    if (!auth.ok) return auth.response;

    const startedAt = Date.now();
    const parsed = parseBizcardSearchParams(request.nextUrl.searchParams);
    if (!parsed.valid) {
      return NextResponse.json(
        { success: false, error: parsed.errors[0] ?? "Invalid search query." },
        { status: 400 }
      );
    }

  try {
    const { q, page, limit, searchIn } = parsed.data;
    const skip = (page - 1) * limit;

    const fieldClauses: Record<string, Array<Record<string, { contains: string }>>> = {
      name: [{ bizcard_name: { contains: q } }],
      first_name: [{ first_name: { contains: q } }],
      last_name: [{ last_name: { contains: q } }],
      all: [
        { bizcard_name: { contains: q } },
        { first_name: { contains: q } },
        { last_name: { contains: q } },
      ],
    };

    const where = {
      user_id: auth.userId,
      OR: fieldClauses[searchIn],
    };

    const [rows, total] = await Promise.all([
      prisma.bizcard.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updated_at: "desc" },
        select: {
          bizcard_id: true,
          bizcard_name: true,
          url_alias: true,
          first_name: true,
          last_name: true,
          professional_title: true,
          profile_img: true,
        },
      }),
      prisma.bizcard.count({ where }),
    ]);

    const queryLower = q.toLowerCase();
    const results = rows
      .map((row) => {
        const score = Math.max(
          computeSimpleMatchScore(row.bizcard_name, queryLower),
          computeSimpleMatchScore(row.first_name, queryLower),
          computeSimpleMatchScore(row.last_name, queryLower)
        );

        const matchedFields: string[] = [];
        if (row.bizcard_name.toLowerCase().includes(queryLower)) matchedFields.push("bizcard_name");
        if (row.first_name.toLowerCase().includes(queryLower)) matchedFields.push("first_name");
        if (row.last_name.toLowerCase().includes(queryLower)) matchedFields.push("last_name");

        return {
          bizcard_id: row.bizcard_id,
          bizcard_name: row.bizcard_name,
          url_alias: row.url_alias,
          first_name: row.first_name,
          last_name: row.last_name,
          professional_title: row.professional_title,
          profile_img: row.profile_img,
          match_score: Number(score.toFixed(2)),
          matched_fields: matchedFields,
          highlight: {
            bizcard_name: buildHighlight(row.bizcard_name, q),
            first_name: buildHighlight(row.first_name, q),
            last_name: buildHighlight(row.last_name, q),
          },
        };
      })
      .sort((a, b) => b.match_score - a.match_score);

    const pages = Math.max(1, Math.ceil(total / limit));
    const matchedFields = new Set<string>();
    for (const row of results) {
      for (const field of row.matched_fields) matchedFields.add(field);
    }

    return NextResponse.json(
      serialize({
        success: true,
        data: {
          bizcards: results,
          pagination: {
            page,
            limit,
            total,
            pages,
          },
          search_metadata: {
            query: q,
            matched_fields: [...matchedFields],
            response_time_ms: Date.now() - startedAt,
          },
        },
      })
    );
    } catch (error) {
      console.error("[user/bizcards/search GET]", error);
      return NextResponse.json(
        { success: false, error: "An unexpected error occurred." },
        { status: 500 }
      );
    }
  });
}
