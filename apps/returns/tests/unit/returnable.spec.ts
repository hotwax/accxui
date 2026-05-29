import { describe, it, expect } from "vitest";
import { computeReturnableLines } from "@/util/returnable";

const orderItems = [
  { orderItemSeqId: "00001", productId: "P1", quantity: 3, unitPrice: 10 },
  { orderItemSeqId: "00002", productId: "P2", quantity: 1, unitPrice: 25 },
];

describe("computeReturnableLines", () => {
  it("returns full ordered qty when nothing returned yet", () => {
    const lines = computeReturnableLines(orderItems, {});
    expect(lines).toEqual([
      { orderItemSeqId: "00001", productId: "P1", orderedQty: 3, alreadyReturnedQty: 0, returnableQty: 3, unitPrice: 10 },
      { orderItemSeqId: "00002", productId: "P2", orderedQty: 1, alreadyReturnedQty: 0, returnableQty: 1, unitPrice: 25 },
    ]);
  });

  it("subtracts already-returned quantities per orderItemSeqId", () => {
    const lines = computeReturnableLines(orderItems, { "00001": 2 });
    expect(lines[0]).toMatchObject({ alreadyReturnedQty: 2, returnableQty: 1 });
    expect(lines[1]).toMatchObject({ alreadyReturnedQty: 0, returnableQty: 1 });
  });

  it("never returns a negative returnableQty", () => {
    const lines = computeReturnableLines(orderItems, { "00002": 5 });
    expect(lines[1].returnableQty).toBe(0);
  });
});
