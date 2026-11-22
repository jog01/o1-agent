import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
export const shortAddress = (value: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not configured";
export const tokenLabel = (token: { symbol?: string; name?: string; token: string }) => token.symbol?.trim() || token.name?.trim() || shortAddress(token.token);
export function weiToEth(value: string) {
  try {
    const wei = BigInt(value);
    const sign = wei < 0n ? "-" : "";
    const abs = wei < 0n ? -wei : wei;
    const fraction = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return `${sign}${abs / 10n ** 18n}${fraction ? `.${fraction}` : ""}`;
  } catch { return "Invalid value"; }
}
export function age(timestamp: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
