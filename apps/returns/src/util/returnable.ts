import type { ReturnableLine } from "@/types/returns";

export interface RawOrderItem {
  orderItemSeqId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

/** Pure: compute returnable qty per line by subtracting already-returned quantities. */
export function computeReturnableLines(
  orderItems: RawOrderItem[],
  returnedQtyBySeqId: Record<string, number>
): ReturnableLine[] {
  return orderItems.map((item) => {
    const alreadyReturnedQty = returnedQtyBySeqId[item.orderItemSeqId] ?? 0;
    const returnableQty = Math.max(0, item.quantity - alreadyReturnedQty);
    return {
      orderItemSeqId: item.orderItemSeqId,
      productId: item.productId,
      orderedQty: item.quantity,
      alreadyReturnedQty,
      returnableQty,
      unitPrice: item.unitPrice,
    };
  });
}
