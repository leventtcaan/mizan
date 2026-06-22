"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Subscriptions are now part of the unified Recurring tab.
export default function SubscriptionsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/recurring"); }, [router]);
  return null;
}
