import { prisma } from "@/server/lib/prisma";
import { prismaAnalytics } from "@/server/lib/prisma-analytics";

type BizcardIdentity = {
  bizcard_id: bigint;
  user_id: bigint | null;
};

export type BizcardBatchEnrichment = {
  serviceCounts: Map<bigint, number>;
  socialCounts: Map<bigint, number>;
  viewsByOwner: Map<bigint, number>;
  contactSavesByOwner: Map<bigint, number>;
  viewCountsByBizcard: Map<bigint, number>;
  contactSaveCountsByBizcard: Map<bigint, number>;
};

export class BatchFetcher {
  static async enrichBizcardsBatch(
    bizcards: BizcardIdentity[],
  ): Promise<BizcardBatchEnrichment> {
    if (bizcards.length === 0) {
      return {
        serviceCounts: new Map(),
        socialCounts: new Map(),
        viewsByOwner: new Map(),
        contactSavesByOwner: new Map(),
        viewCountsByBizcard: new Map(),
        contactSaveCountsByBizcard: new Map(),
      };
    }

    const bizcardIds = bizcards.map((item) => item.bizcard_id);
    const ownerIds = [
      ...new Set(
        bizcards
          .map((item) => item.user_id)
          .filter((id): id is bigint => id !== null),
      ),
    ];

    const [serviceCounts, socialCounts, portfolioViews, contactSaves] =
      await Promise.all([
        prisma.service.groupBy({
          by: ["bizcard_id"],
          where: {
            bizcard_id: { in: bizcardIds },
            is_visible: true,
            status: "active",
          },
          _count: { _all: true },
        }),
        prisma.social.groupBy({
          by: ["bizcard_id"],
          where: {
            bizcard_id: { in: bizcardIds },
            is_visible: true,
          },
          _count: { _all: true },
        }),
        ownerIds.length > 0
          ? prismaAnalytics.portfolioView.groupBy({
              by: ["portfolio_owner_id"],
              where: { portfolio_owner_id: { in: ownerIds } },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        ownerIds.length > 0
          ? prismaAnalytics.contactSave.groupBy({
              by: ["portfolio_owner_id"],
              where: { portfolio_owner_id: { in: ownerIds } },
              _count: { _all: true },
            })
          : Promise.resolve([]),
      ]);

    const serviceCountMap = new Map<bigint, number>();
    for (const row of serviceCounts) {
      if (!row.bizcard_id) continue;
      serviceCountMap.set(row.bizcard_id, row._count._all);
    }

    const socialCountMap = new Map<bigint, number>();
    for (const row of socialCounts) {
      if (!row.bizcard_id) continue;
      socialCountMap.set(row.bizcard_id, row._count._all);
    }

    const viewsByOwner = new Map<bigint, number>();
    for (const row of portfolioViews) {
      viewsByOwner.set(row.portfolio_owner_id, row._count._all);
    }

    const contactSavesByOwner = new Map<bigint, number>();
    for (const row of contactSaves) {
      contactSavesByOwner.set(row.portfolio_owner_id, row._count._all);
    }

    const viewCountsByBizcard = new Map<bigint, number>();
    const contactSaveCountsByBizcard = new Map<bigint, number>();
    for (const bizcard of bizcards) {
      const ownerId = bizcard.user_id;
      viewCountsByBizcard.set(
        bizcard.bizcard_id,
        ownerId ? (viewsByOwner.get(ownerId) ?? 0) : 0,
      );
      contactSaveCountsByBizcard.set(
        bizcard.bizcard_id,
        ownerId ? (contactSavesByOwner.get(ownerId) ?? 0) : 0,
      );
    }

    return {
      serviceCounts: serviceCountMap,
      socialCounts: socialCountMap,
      viewsByOwner,
      contactSavesByOwner,
      viewCountsByBizcard,
      contactSaveCountsByBizcard,
    };
  }

  static async enrichUsersBatch(userIds: bigint[]) {
    if (userIds.length === 0) {
      return {
        userMap: new Map(),
        subscriptionMap: new Map(),
        companyMap: new Map(),
      };
    }

    const [users, subscriptions] = await Promise.all([
      prisma.user.findMany({
        where: { user_id: { in: userIds } },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          profile_url: true,
          role: true,
          company_id: true,
        },
      }),
      prisma.bizcardSubscription.findMany({
        where: {
          bizcard: { user_id: { in: userIds }, deactivated_flag: false },
          status: "active",
        },
        select: {
          bizcard: { select: { user_id: true } },
          plan_id: true,
          status: true,
          expires_at: true,
        },
      }),
    ]);

    const subscriptionMap = new Map<bigint, any>();
    for (const sub of subscriptions) {
      const userId = sub.bizcard.user_id;
      if (userId !== null && !subscriptionMap.has(userId)) {
        subscriptionMap.set(userId, sub);
      }
    }

    const companyIds = [
      ...new Set(
        users
          .map((user) => user.company_id)
          .filter((id): id is bigint => id !== null),
      ),
    ];
    const companies = companyIds.length
      ? await prisma.company.findMany({
          where: { company_id: { in: companyIds } },
          select: {
            company_id: true,
            name: true,
            company_slug: true,
            logo_url: true,
            subscription_tier: true,
          },
        })
      : [];

    return {
      userMap: new Map(users.map((user) => [user.user_id, user])),
      subscriptionMap,
      companyMap: new Map(
        companies.map((company) => [company.company_id, company]),
      ),
    };
  }

  static async enrichShopOrdersBatch(orderIds: bigint[]) {
    if (orderIds.length === 0) {
      return {
        orderMap: new Map(),
        itemsByOrder: new Map(),
      };
    }

    const [orders, items] = await Promise.all([
      prisma.shopOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          user_id: true,
          status: true,
          subtotal: true,
          total_amount: true,
          currency: true,
          placed_at: true,
        },
      }),
      prisma.shopOrderItem.findMany({
        where: { order_id: { in: orderIds } },
        select: {
          order_id: true,
          item_type: true,
          item_id: true,
          item_name: true,
          quantity: true,
          total_price: true,
        },
      }),
    ]);

    const itemsByOrder = new Map<bigint, typeof items>();
    for (const item of items) {
      const orderItems = itemsByOrder.get(item.order_id) ?? [];
      orderItems.push(item);
      itemsByOrder.set(item.order_id, orderItems);
    }

    return {
      orderMap: new Map(orders.map((order) => [order.id, order])),
      itemsByOrder,
    };
  }
}
