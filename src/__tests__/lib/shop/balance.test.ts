import { describe, expect, it } from "vitest";
import { quantityAddsUp } from "@/lib/shop/routers";

describe("router quantity balance", () => {
  it("accepts buckets that equal the order quantity", () => {
    expect(quantityAddsUp({
      orderQty: 20,
      qtyRunning: 17,
      qtyWaiting: 0,
      qtyScrap: 0,
      qtyFinished: 0,
      qtyShipped: 0,
    })).toBe(false);
    expect(quantityAddsUp({
      orderQty: 20,
      qtyRunning: 20,
      qtyWaiting: 0,
      qtyScrap: 0,
      qtyFinished: 0,
      qtyShipped: 0,
    })).toBe(true);
  });
});
