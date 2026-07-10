// Shared browser-side Razorpay Checkout loader + typings, used by PlanPicker
// (subscriptions) and OneOffPicker (orders). Keep the global declaration in
// one place — duplicate `declare global` blocks with different shapes clash.

export type RazorpayCheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_subscription_id?: string;
  razorpay_order_id?: string;
  razorpay_signature: string;
};

export type RazorpayCheckoutOptions = {
  key: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (r: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
  // Subscription checkout
  subscription_id?: string;
  // One-off order checkout
  amount?: number;
  currency?: string;
  order_id?: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export function loadRazorpay(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
