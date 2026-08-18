// Birthday and referral free sessions — when they fire, and that they fire once.
//
// Duplicated from app.js (search `runBirthdayGrants`) because app.js is one
// IIFE with no exports. IF YOU CHANGE THE ORIGINAL, CHANGE THIS COPY TOO.
//
// This earns a test because both passes run on EVERY calendar load. A missing
// idempotency guard doesn't throw and doesn't look wrong on screen — it quietly
// hands an athlete a free session per page load until someone notices the
// balance climbing. The lookback matters for the same reason in reverse: a
// birthday typed in December must not back-grant one from March.

const REWARD_LOOKBACK_DAYS = 30;

const pad = (n) => String(n).padStart(2, "0");
const dateISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBetween = (a, b) =>
  Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);

function birthdayThisYear(iso, year) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  const [, mm, dd] = iso.split("-").map(Number);
  return dateISO(new Date(year, mm - 1, dd));
}
function hasGrantTag(c, key, val) {
  return (c.sessionBank?.packages || []).some((p) => p && p[key] === val);
}
function freeSessionPkg(note, tag) {
  return { id: Math.random().toString(36), size: 1, price: 0, unpaid: false,
    status: "paid", note, ...tag };
}

// `today` injected instead of read from the clock.
function runBirthdayGrants(clients, today) {
  const year = String(Number(today.slice(0, 4)));
  const granted = [];
  clients.forEach((c) => {
    if (!c.birthday) return;
    if (hasGrantTag(c, "birthdayGrant", year)) return;
    const due = birthdayThisYear(c.birthday, Number(year));
    if (!due || due > today) return;
    if (daysBetween(due, today) > REWARD_LOOKBACK_DAYS) return;
    c.sessionBank.packages.push(freeSessionPkg(
      `Birthday session · ${c.name} · ${year}`, { birthdayGrant: year }));
    granted.push(c);
  });
  return granted;
}
function runReferralGrants(clients) {
  const granted = [];
  clients.forEach((c) => {
    if (!c.referredBy) return;
    const ref = clients.find((x) => x.id === c.referredBy);
    if (!ref || ref.id === c.id) return;
    if (hasGrantTag(ref, "referralGrant", c.id)) return;
    if (!(c.sessionBank.redemptions || []).length) return;
    ref.sessionBank.packages.push(freeSessionPkg(
      `Referral · brought in ${c.name}`, { referralGrant: c.id }));
    granted.push(ref);
  });
  return granted;
}

// The REAL ledger and pkgOwed, from the extracted module (Phase 3): requiring
// it executes the classic script, which assigns onto globalThis.STSD.money.
// This used to be a trimmed hand copy, which is exactly the drift class the
// extraction exists to kill.
require(require("path").join(__dirname, "..", "src", "money", "ledger.js"));
const { bankLedger, pkgOwed } = globalThis.STSD.money;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}
const athlete = (o) => ({ id: "a", name: "A", birthday: "", referredBy: "",
  sessionBank: { packages: [], redemptions: [] }, ...o });

console.log("\nFree sessions");

// ---- Birthdays ----
{
  const c = athlete({ birthday: "1994-08-04" });
  check("grants on the day", runBirthdayGrants([c], "2026-08-04").length, 1);
  check("  package is size 1, price 0, unpaid false",
    [c.sessionBank.packages[0].size, c.sessionBank.packages[0].price, c.sessionBank.packages[0].unpaid],
    [1, 0, false]);
}
{
  const c = athlete({ birthday: "1994-08-04" });
  runBirthdayGrants([c], "2026-08-04");
  runBirthdayGrants([c], "2026-08-04");
  runBirthdayGrants([c], "2026-08-11");
  check("fires once per year however often the pass runs", c.sessionBank.packages.length, 1);
}
{
  const c = athlete({ birthday: "1994-08-04" });
  runBirthdayGrants([c], "2026-08-04");
  runBirthdayGrants([c], "2027-08-04");
  check("fires again the next year", c.sessionBank.packages.length, 2);
}
{
  const c = athlete({ birthday: "1994-08-04" });
  check("not before the day", runBirthdayGrants([c], "2026-08-03").length, 0);
}
{
  const c = athlete({ birthday: "1994-08-04" });
  check("lands late if the coach didn't open the app",
    runBirthdayGrants([c], "2026-08-20").length, 1);
}
{
  const c = athlete({ birthday: "1994-03-01" });
  check("a birthday typed months later does NOT back-grant",
    runBirthdayGrants([c], "2026-12-01").length, 0);
}
{
  const c = athlete({ birthday: "" });
  check("no birthday on file, no grant", runBirthdayGrants([c], "2026-08-04").length, 0);
}
{
  // Feb 29 in a common year: the Date constructor rolls it to Mar 1.
  const c = athlete({ birthday: "2000-02-29" });
  check("Feb 29 lands on Mar 1 in a common year",
    birthdayThisYear("2000-02-29", 2026), "2026-03-01");
  check("  and still grants", runBirthdayGrants([c], "2026-03-01").length, 1);
}

// ---- Referrals ----
{
  const ref = athlete({ id: "r", name: "Ref" });
  const nu = athlete({ id: "n", name: "New", referredBy: "r" });
  check("no grant until the newcomer trains", runReferralGrants([ref, nu]).length, 0);
  nu.sessionBank.redemptions.push({ id: "x", date: "2026-08-04" });
  check("grants once they do", runReferralGrants([ref, nu]).length, 1);
  check("  and it names them", ref.sessionBank.packages[0].note, "Referral · brought in New");
}
{
  const ref = athlete({ id: "r", name: "Ref" });
  const nu = athlete({ id: "n", name: "New", referredBy: "r",
    sessionBank: { packages: [], redemptions: [{ id: "x", date: "2026-08-04" }] } });
  runReferralGrants([ref, nu]);
  runReferralGrants([ref, nu]);
  runReferralGrants([ref, nu]);
  check("fires once per referred person", ref.sessionBank.packages.length, 1);
}
{
  const ref = athlete({ id: "r", name: "Ref" });
  const a = athlete({ id: "n1", name: "N1", referredBy: "r",
    sessionBank: { packages: [], redemptions: [{ id: "x", date: "2026-08-04" }] } });
  const b = athlete({ id: "n2", name: "N2", referredBy: "r",
    sessionBank: { packages: [], redemptions: [{ id: "y", date: "2026-08-05" }] } });
  runReferralGrants([ref, a, b]);
  check("two referrals earn two sessions", ref.sessionBank.packages.length, 2);
}
{
  const c = athlete({ id: "r", name: "Self", referredBy: "r",
    sessionBank: { packages: [], redemptions: [{ id: "x", date: "2026-08-04" }] } });
  check("cannot refer yourself", runReferralGrants([c]).length, 0);
}
{
  const nu = athlete({ id: "n", name: "New", referredBy: "gone",
    sessionBank: { packages: [], redemptions: [{ id: "x", date: "2026-08-04" }] } });
  check("a deleted referrer is not an error", runReferralGrants([nu]).length, 0);
}

// ---- What a free session is actually worth ----
{
  // The whole reason for no month key: it must survive the month it was given.
  const bank = {
    packages: [
      { size: 8, price: 725, autoRenewGrant: "2026-07" },   // July's allowance
      { size: 1, price: 0, birthdayGrant: "2026" },         // the gift
    ],
    redemptions: [],
  };
  const l = bankLedger(bank, "2026-08", false);
  check("July's allowance expires, the gift does not", [l.expired, l.banked], [8, 1]);
}
{
  // And it is an EXTRA, not a substitute: the paid allowance goes first.
  const bank = {
    packages: [
      { size: 2, price: 725, autoRenewGrant: "2026-08" },
      { size: 1, price: 0, birthdayGrant: "2026" },
    ],
    redemptions: [{ date: "2026-08-02" }, { date: "2026-08-09" }],
  };
  const l = bankLedger(bank, "2026-08", false);
  check("two sessions spend the allowance, the gift is still there",
    [l.thisMonth, l.banked, l.remaining], [0, 1, 1]);
}
{
  const bank = {
    packages: [
      { size: 2, price: 725, autoRenewGrant: "2026-08" },
      { size: 1, price: 0, birthdayGrant: "2026" },
    ],
    redemptions: [{ date: "2026-08-02" }, { date: "2026-08-09" }, { date: "2026-08-16" }],
  };
  const l = bankLedger(bank, "2026-08", false);
  check("the third session comes out of the gift", [l.thisMonth, l.banked], [0, 0]);
}
{
  // Money: a free package must never appear in what anyone owes.
  // pkgOwed is the shipped one, required above.
  const packages = [
    { size: 8, price: 725, unpaid: true, autoRenewGrant: "2026-08" },
    freeSessionPkg("Birthday", { birthdayGrant: "2026" }),
    freeSessionPkg("Referral", { referralGrant: "n" }),
  ];
  const owed = packages.filter(pkgOwed);
  check("only the membership is owed", owed.length, 1);
  check("  and the total is the membership alone",
    owed.reduce((n, p) => n + (Number(p.price) || 0), 0), 725);
}

console.log(failures ? `\n${failures} failure(s)\n` : "\nAll passed\n");
process.exit(failures ? 1 : 0);
