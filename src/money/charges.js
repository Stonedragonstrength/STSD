// Extracted from app.js — Phase 3 (Money) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/money/charges.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// The billing readers: which charge a month has (chargeFor — couple-aware,
// either half answers), what one athlete owes as ONE number (athleteOwed —
// the cash side and the card side resolved per month, never summed twice),
// when money last actually arrived (lastPaymentFor), which months are still
// outstanding (unpaidChargeMonths) and whether a month's money came back
// (billingRefundedFor). Real athletes' money: bodies verbatim, zero behavior
// change. settleBilledPackages (the apply half) and chargeStatusLabel (the
// display half) stay in app.js.
//
// The bodies read `_billing.payments` — a session window owned by app.js
// (design doc §4 rule 3: never duplicate a shared singleton). The local
// `_billing` below is a GETTER onto the STSD.app.billingPayments reader, so
// every body stays byte-verbatim and still reads the live window at call
// time, never a captured copy.
(function () {
  "use strict";

  function todayISO() {
    return globalThis.STSD.app.todayISO();
  }
  function dateISO(d) {
    return globalThis.STSD.app.dateISO(d);
  }
  function ensureSessionBank(c) {
    return globalThis.STSD.app.ensureSessionBank(c);
  }
  const _billing = {
    get payments() { return globalThis.STSD.app.billingPayments(); },
  };

  // From src/money/ledger.js and src/training/stat-field.js, which
  // index.html loads first (the boot smoke executes the tags in that order).
  // Checked at load so a missing or misordered tag fails HERE, by name.
  const { pkgOwed, pkgMonth } = globalThis.STSD?.money || {};
  const { daysBetweenISO } = globalThis.STSD?.training || {};
  [["pkgOwed", pkgOwed], ["pkgMonth", pkgMonth], ["daysBetweenISO", daysBetweenISO]].forEach(([name, fn]) => {
    if (typeof fn !== "function") {
      throw new Error(`ledger.js and stat-field.js must load before charges.js (missing ${name})`);
    }
  });
  // The same question about money given back. Used to undo a settle: a package
  // marked collected because a card paid for it is not collected any more once
  // that card payment has been refunded.
  function billingRefundedFor(c, monthKey) {
    if (!c) return false;
    const pid = c.partnerId || null;
    return (_billing.payments || []).some((p) =>
      p.month_key === monthKey && p.status === "refunded" &&
      (p.athlete_id === c.id || (pid && p.athlete_id === pid)));
  }
  // Months with a card charge still outstanding, oldest first. A NOTICE, never
  // a gate: this app's own rule is that sessions are live the day they're
  // granted and the money is chased separately, and quietly withholding
  // somebody's training over a card is a different product.
  // ---- What one athlete owes, as ONE number ----
  //
  // A debt can be recorded in two places and nothing added them up before this.
  // Packages carry `unpaid` on the bank (the cash side, what
  // sessionBankSummary().owedAmount sums); card charges live in
  // `billing_payments` and unpaidChargeMonths returns MONTHS, not dollars. A
  // coach reading either one alone is reading half of what he is owed.
  //
  // The catch, and the reason this is not a sum of the two: for one month they
  // are usually the SAME debt. settleBilledPackages() only clears `unpaid` once
  // a month is PAID, so a month that was invoiced and ignored has the charge
  // sitting at "sent" AND its package still flagged — adding both bills the
  // athlete twice on screen. So this resolves per month and takes the charge's
  // amount when there is one, since that is the figure actually sent to them.
  //
  // Packages with no month key (a one-off pack, not a membership grant) have no
  // charge to collide with and simply add.
  function athleteOwed(c) {
    const out = { total: 0, months: [], oldestDays: 0, fromCard: 0, fromPackages: 0 };
    if (!c) return out;
    ensureSessionBank(c);
    const pid = c.partnerId || null;
    const mine = (p) => p.athlete_id === c.id || (pid && p.athlete_id === pid);
    const today = todayISO().slice(0, 7);

    // Every month with a charge that went out and was never paid.
    const charged = new Map();
    (_billing.payments || []).forEach((p) => {
      if (!mine(p) || p.status !== "sent" || !p.month_key) return;
      const prev = charged.get(p.month_key);
      // Two rows for one month means it was re-sent; the newest is the ask.
      if (!prev || String(p.created_at || "") > String(prev.created_at || "")) charged.set(p.month_key, p);
    });

    const seen = new Set();
    charged.forEach((p, key) => {
      const amt = (Number(p.amount_cents) || 0) / 100;
      out.total += amt;
      out.fromCard += amt;
      seen.add(key);
      // Only a PAST month is overdue; this month's invoice is not late yet.
      if (key < today) out.months.push(key);
      const days = p.created_at ? daysBetweenISO(String(p.created_at).slice(0, 10), todayISO()) : 0;
      if (days > out.oldestDays) out.oldestDays = days;
    });

    (c.sessionBank.packages || []).forEach((p) => {
      if (!pkgOwed(p)) return;
      const key = pkgMonth(p);
      if (key && seen.has(key)) return;          // same debt, already counted
      const amt = Number(p.price) || 0;
      out.total += amt;
      out.fromPackages += amt;
      if (key && key < today) out.months.push(key);
      const from = p.addedAt ? new Date(p.addedAt) : null;
      const days = from ? daysBetweenISO(dateISO(from), todayISO()) : 0;
      if (days > out.oldestDays) out.oldestDays = days;
    });

    out.months.sort();
    out.total = Math.round(out.total * 100) / 100;
    return out;
  }

  // When money last actually arrived. bankPayBy already sorts these rows by
  // date to read the payment METHOD off the newest one and then throws the date
  // away; this keeps it, because "when did they last pay me" is a question the
  // coach asks and nothing could answer.
  function lastPaymentFor(c) {
    if (!c) return null;
    const pid = c.partnerId || null;
    let best = null;
    (_billing.payments || []).forEach((p) => {
      if (p.status !== "paid") return;
      if (!(p.athlete_id === c.id || (pid && p.athlete_id === pid))) return;
      const at = p.paid_at || p.created_at || "";
      if (!best || String(at) > String(best.at)) best = { at: String(at), row: p };
    });
    if (!best) return null;
    return {
      at: best.at.slice(0, 10),
      amount: (Number(best.row.amount_cents) || 0) / 100,
      method: best.row.method === "manual" ? "cash" : "card",
    };
  }

  function unpaidChargeMonths(c) {
    if (!c) return [];
    const pid = c.partnerId || null;
    const thisMonth = todayISO().slice(0, 7);
    return (_billing.payments || [])
      .filter((p) => (p.athlete_id === c.id || (pid && p.athlete_id === pid)) &&
        p.status === "sent" && p.month_key && p.month_key < thisMonth)
      .map((p) => p.month_key)
      .sort();
  }

  // The month's charge for this BANK, not this athlete. A couple share one
  // allowance and get one invoice, raised against whichever half is the bank's
  // primary — so looking only at `c.id` told the other half's Sessions tab that
  // nothing had been billed, and offered a second charge for money already
  // asked for. Matching either half is what makes the two agree.
  const chargeFor = (c, monthKey) => {
    const pid = c?.partnerId || null;
    return (_billing.payments || []).find((p) =>
      p.month_key === monthKey &&
      (p.athlete_id === c.id || (pid && p.athlete_id === pid)) &&
      (p.status === "sent" || p.status === "paid")) || null;
  };

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, {
    billingRefundedFor, athleteOwed, lastPaymentFor, unpaidChargeMonths,
    chargeFor,
  });
})();
