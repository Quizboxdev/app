import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Seats on a quiz (migration 20261041100000). A quiz is free for a few players; to host more, the organiser pays 1 Coin per player from their wallet. The database decides everything; this only asks and shows.
export type SeatsInfo = { enabled: boolean; free_seats: number; seat_cap: number | null; seats_paid: number; joined: number; class_targeted: boolean; ends_at: string | null };
export type SeatStatus = { capped: boolean; cap: number | null; joined: number; full: boolean } | null;
export const SEAT_TIERS = [10, 20, 50, 100, 200, 500, 1000] as const;
export const MIN_SEATS = 6, MAX_SEATS = 1000, MIN_TOPUP = 5;

// The Coins still to pay to reach a total of `target` players (upgrades pay only the difference), and how many Coins must be bought first if the wallet is short. The smallest online payment is 5 Coins.
export const seatCost = (target: number, paid: number) => Math.max(0, target - paid);
export const shortfall = (cost: number, balance: number) => Math.max(0, cost - balance);
export const topupAmount = (missing: number) => (missing <= 0 ? 0 : Math.max(MIN_TOPUP, missing));

const MESSAGES: Record<string, string> = {
  QB_INVALID_SEATS: `Choose a number of players from ${MIN_SEATS} to ${MAX_SEATS}, more than you have paid for already.`,
  QB_INSUFFICIENT_BALANCE: "You do not have enough Coins yet. Buy Coins first.",
  QB_FEATURE_DISABLED: "Paying for more players is not open yet.",
  QB_SEATS_NOT_NEEDED: "A quiz for one class or school has no player limit, so there is nothing to pay.",
  NOT_AUTHORIZED: "Only the person who made this quiz can add places.",
};
const rpc = <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => Promise.resolve(getSupabaseBrowserClient().rpc(fn, args)).then(({ data, error }) => {
  if (error) { const code = /(QB_[A-Z_]+|NOT_AUTHORIZED)/.exec(error.message)?.[1] ?? ""; throw new Error(MESSAGES[code] ?? "That did not work. Please try again."); }
  return data as T;
});
export const seatsInfo = (id: string) => rpc<SeatsInfo>("qb_challenge_seats_info", { p_id: id });
export const buySeats = (id: string, seats: number) => rpc<{ ok: boolean; already: boolean; seat_cap: number; coins?: number }>("qb_challenge_seats_buy", { p_campaign: id, p_seats: seats });
export const seatStatus = (slug: string) => rpc<SeatStatus>("qb_challenge_seat_status", { p_slug: slug });
