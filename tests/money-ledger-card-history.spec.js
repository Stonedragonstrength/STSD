// Books read zero card revenue for any month older than the charge fetch
// window: getBillingForCoach clipped billing_payments to three months, and
// moneyLedger skipped every card-paid package on the assumption a charge row
// would speak for it. A month outside the window had neither. The fetch clip
// is gone (cloud.js) and these tests pin the ledger half: a card-paid package
// with no charge row is a real entry, and one WITH a charge row still is not
// double-counted.
import { describe, it, expect } from "vitest";
import { loadFn } from "./helpers/load-fn.js";

const athlete = (packages) => ({
  id: "a1",
  name: "Ath",
  sessionBank: { packages },
});

function ledgerWith({ payments = [], packages = [] }) {
  const c = athlete(packages);
  const moneyLedger = loadFn("function moneyLedger(", {
    _billing: { payments },
    eachBank: () => [{ c, partner: null, ids: ["a1"], name: "Ath" }],
    bankMembership: () => "monthly",
    pkgMonth: (pkg) => pkg.month || null,
    pkgOwed: (pkg) => pkg.owed || 0,
    dateISO: (d) => d.toISOString().slice(0, 10),
  });
  return moneyLedger();
}

describe("moneyLedger card history", () => {
  it("a card-paid package with no charge row is on the books, as card, settled", () => {
    const entries = ledgerWith({
      packages: [{ id: "p1", price: 500, size: 8, month: "2025-11", paidBy: "card", paidAt: 1735000000000 }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ monthKey: "2025-11", amount: 500, paid: true, how: "card" });
  });

  it("a card-paid package whose month a charge row covers is not double-counted", () => {
    const entries = ledgerWith({
      payments: [{ athlete_id: "a1", month_key: "2026-06", status: "paid", amount_cents: 50000, sessions: 8, paid_at: "2026-06-02" }],
      packages: [{ id: "p1", price: 500, size: 8, month: "2026-06", paidBy: "card" }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].charge).toBeTruthy();
    expect(entries[0].amount).toBe(500);
  });

  it("a cash package still reads as cash, owed when owed", () => {
    const entries = ledgerWith({
      packages: [{ id: "p1", price: 300, size: 4, month: "2026-05", owed: 300, addedAt: 1747000000000 }],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ how: "cash", paid: false });
  });
});
