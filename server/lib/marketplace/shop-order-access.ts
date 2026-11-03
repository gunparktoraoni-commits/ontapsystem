import { prisma } from "@/server/lib/prisma";
import type { Prisma, ShopOrder, ShopOrderItem } from "@prisma/client";

export type UserShopOrderWithItems = ShopOrder & {
  items: Pick<
    ShopOrderItem,
    | "item_type"
    | "item_id"
    | "item_name"
    | "quantity"
    | "unit_price"
    | "total_price"
  >[];
};

export function parseShopOrderIdentifier(raw: string): {
  isNumericId: boolean;
  trimmed: string;
} {
  const trimmed = raw.trim();
  return { trimmed, isNumericId: /^\d+$/.test(trimmed) };
}

export function buildUserShopOrderWhere(
  userId: bigint,
  orderIdentifier: string,
): Prisma.ShopOrderWhereInput {
  const { trimmed, isNumericId } = parseShopOrderIdentifier(orderIdentifier);
  return {
    user_id: userId,
    ...(isNumericId
      ? { OR: [{ id: BigInt(trimmed) }, { order_number: trimmed }] }
      : { order_number: trimmed }),
  };
}

export async function findUserShopOrder(
  userId: bigint,
  orderIdentifier: string,
): Promise<UserShopOrderWithItems | null> {
  const { trimmed } = parseShopOrderIdentifier(orderIdentifier);
  if (!trimmed) return null;

  return prisma.shopOrder.findFirst({
    where: buildUserShopOrderWhere(userId, trimmed),
    include: {
      items: {
        select: {
          item_type: true,
          item_id: true,
          item_name: true,
          quantity: true,
          unit_price: true,
          total_price: true,
        },
      },
    },
  });
}
