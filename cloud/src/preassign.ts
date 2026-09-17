/**
 * preassign.ts — units reserved for an email BEFORE the account exists.
 *
 * Admin registers a unit with an email (e.g. Devin's own Pi, #0000001, or a
 * unit going out to a customer who hasn't signed up yet). The unit carries
 * `reservedFor`. The first time that email signs up or logs in, the unit binds
 * to the account, the profile gets its bot # and is entitled, and — for admin
 * emails — the account is simply an owner from the start. So "set a password"
 * is the whole onboarding for someone we already know.
 */
import type { Store, Account } from "./store.js";
import { isAdminEmail } from "./sync.js";

export type Preassigned = { botNumber: string | null; admin: boolean; bound: string[] };

/** Bind every unit reserved for this account's email; entitle admins. Idempotent. */
export async function bindPreassigned(store: Store, account: Account): Promise<Preassigned> {
  const email = account.email.toLowerCase();
  const admin = isAdminEmail(email);
  const bound: string[] = [];
  const units = (await store.listUnits()).filter((u) => !u.accountId && (u.reservedFor ?? "").toLowerCase() === email).sort((a, b) => a.botNumber.localeCompare(b.botNumber));
  for (const u of units) {
    await store.updateUnit(u.botNumber, { accountId: account.id, claimedAt: Date.now() });
    bound.push(u.botNumber);
  }
  const profile = (await store.getProfile(account.id)) ?? {};
  const botNumber = (profile["botNumber"] as string | undefined) ?? bound[0] ?? null;
  if (bound.length || (admin && profile["entitled"] !== true)) {
    await store.setProfile(account.id, { ...profile, entitled: true, ...(botNumber ? { botNumber } : {}) });
  }
  return { botNumber, admin, bound };
}

/** What we know about an email before it has an account (for the "we know you" prompt). */
export async function lookupEmail(store: Store, emailRaw: string): Promise<{ exists: boolean; preassigned: boolean; botNumber: string | null; admin: boolean }> {
  const email = emailRaw.toLowerCase();
  const account = await store.getAccountByEmail(email);
  const admin = isAdminEmail(email);
  let botNumber: string | null = null;
  if (account) {
    botNumber = ((await store.getProfile(account.id))?.["botNumber"] as string | undefined) ?? null;
  }
  if (!botNumber) {
    const unit = (await store.listUnits()).filter((u) => (u.reservedFor ?? "").toLowerCase() === email || (account && u.accountId === account.id)).sort((a, b) => a.botNumber.localeCompare(b.botNumber))[0];
    botNumber = unit?.botNumber ?? null;
  }
  return { exists: !!account, preassigned: !!botNumber || admin, botNumber, admin };
}
