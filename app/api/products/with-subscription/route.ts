import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

interface ProductSubscriptionData {
  id: number;
  name: string;
  description: string | null;
  price: number;
  subscription_tier: string | null;
  subscription_duration_days: number | null;
  features: string[];
}

export async function GET(request: NextRequest) {
  try {
    // Optional query params for filtering
    const searchParams = request.nextUrl.searchParams;
    const tier = searchParams.get("tier");
    const hasSubscription = searchParams.get("hasSubscription") === "true";

    const whereClause: any = {};

    // Filter by tier if specified
    if (tier) {
      whereClause.subscription_tier = tier;
    }

    // Filter to only products with subscriptions if requested
    if (hasSubscription) {
      whereClause.subscription_tier = { not: null };
    }

    const products = await prisma.merchandise.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        subscription_tier: true,
        subscription_duration_days: true,
      },
      orderBy: { id: "asc" },
    });

    // Enrich with tier features
    const enrichedProducts = await Promise.all(
      products.map(async (product) => {
        let features: string[] = [];

        if (product.subscription_tier) {
          const tier = await prisma.subscriptionPlan.findUnique({
            where: { tier_code: product.subscription_tier },
            select: { features: true },
          });

          if (tier && tier.features) {
            try {
              features = JSON.parse(tier.features as string);
            } catch {
              features = [];
            }
          }
        }

        return {
          id: Number(product.id),
          name: product.name,
          description: product.description,
          price: Number(product.price || 0),
          subscription_tier: product.subscription_tier,
          subscription_duration_days: product.subscription_duration_days,
          features: Array.isArray(features) ? features : [],
        } as ProductSubscriptionData;
      })
    );

    return NextResponse.json(
      {
        success: true,
        data: enrichedProducts,
        count: enrichedProducts.length,
        filters: {
          tier: tier || null,
          hasSubscription: hasSubscription || false,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[products/with-subscription error]", error);

    return NextResponse.json(
      {
        error: "FETCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to fetch products",
      },
      { status: 500 }
    );
  }
}
