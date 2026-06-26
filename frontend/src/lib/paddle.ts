"use client";

// Thin wrapper around Paddle.js (v2). Lazy-loads the script, initializes once with our
// client token + environment, and exposes openCheckout(). Paddle is our Merchant of
// Record, so the browser only ever opens a checkout overlay — it never touches card data.

type PlanId = "plus" | "pro";
type Cycle = "monthly" | "yearly";

interface PaddleCheckoutItem { priceId: string; quantity: number }
interface PaddleGlobal {
  Environment: { set: (env: string) => void };
  Initialize: (opts: { token: string; eventCallback?: (e: PaddleEvent) => void }) => void;
  Checkout: { open: (opts: Record<string, unknown>) => void };
}
interface PaddleEvent { name?: string; data?: unknown }

declare global {
  interface Window { Paddle?: PaddleGlobal }
}

const CLIENT_TOKEN = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
const ENVIRONMENT = process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT ?? "sandbox";

// Price IDs by plan + cycle (created in the Paddle catalog; must match the backend).
const PRICE_IDS: Record<PlanId, Record<Cycle, string>> = {
  plus: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS_MONTHLY ?? "",
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PLUS_YEARLY ?? "",
  },
  pro: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTHLY ?? "",
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEARLY ?? "",
  },
};

export function priceIdFor(plan: PlanId, cycle: Cycle): string {
  return PRICE_IDS[plan]?.[cycle] ?? "";
}

/** True only when the client token AND all four price IDs are configured. When false the
 *  UI should fall back gracefully (e.g. keep the buttons disabled / show a notice). */
export function paddleConfigured(): boolean {
  return Boolean(
    CLIENT_TOKEN &&
    PRICE_IDS.plus.monthly && PRICE_IDS.plus.yearly &&
    PRICE_IDS.pro.monthly && PRICE_IDS.pro.yearly,
  );
}

let loadPromise: Promise<PaddleGlobal | null> | null = null;
let onCompleteHandler: (() => void) | null = null;

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") { reject(new Error("no document")); return; }
    if (window.Paddle) { resolve(); return; }
    const existing = document.querySelector('script[data-paddle="v2"]') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener("load", () => resolve()); existing.addEventListener("error", () => reject(new Error("paddle load failed"))); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.async = true;
    s.dataset.paddle = "v2";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("paddle load failed"));
    document.head.appendChild(s);
  });
}

/** Load + initialize Paddle.js once. Returns the Paddle global, or null if unconfigured. */
export async function loadPaddle(): Promise<PaddleGlobal | null> {
  if (!paddleConfigured()) return null;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await injectScript();
    const P = window.Paddle;
    if (!P) return null;
    try { P.Environment.set(ENVIRONMENT); } catch { /* ignore */ }
    P.Initialize({
      token: CLIENT_TOKEN,
      eventCallback: (e: PaddleEvent) => {
        if (e?.name === "checkout.completed" && onCompleteHandler) onCompleteHandler();
      },
    });
    return P;
  })();
  return loadPromise;
}

/**
 * Open the Paddle checkout overlay for a plan + cycle. customData (user_id + plan) rides
 * through to the subscription so the webhook can grant the right plan to the right user.
 * onComplete fires when checkout.completed is received.
 */
export async function openCheckout(opts: {
  plan: PlanId;
  cycle: Cycle;
  email?: string;
  userId: string;
  onComplete?: () => void;
}): Promise<boolean> {
  const P = await loadPaddle();
  const priceId = priceIdFor(opts.plan, opts.cycle);
  if (!P || !priceId) return false;
  onCompleteHandler = opts.onComplete ?? null;
  const checkout: Record<string, unknown> = {
    items: [{ priceId, quantity: 1 } as PaddleCheckoutItem],
    customData: { user_id: opts.userId, plan: opts.plan },
    settings: { displayMode: "overlay", theme: "light" },
  };
  if (opts.email) checkout.customer = { email: opts.email };
  P.Checkout.open(checkout);
  return true;
}
