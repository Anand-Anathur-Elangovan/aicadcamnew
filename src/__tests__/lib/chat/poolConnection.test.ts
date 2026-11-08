import { describe, it, expect } from "vitest";
import { poolConnection } from "@/lib/chat/sessions";

describe("poolConnection", () => {
  it("drops sslmode and accepts the Supabase pooler certificate chain", () => {
    const c = poolConnection("postgresql://postgres.x:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(c.connectionString).not.toContain("sslmode");
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });
  it("keeps local databases without TLS", () => {
    expect(poolConnection("postgresql://u:p@localhost:5432/db").ssl).toBeUndefined();
  });
});
