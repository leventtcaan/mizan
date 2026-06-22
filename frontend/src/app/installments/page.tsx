"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Installments are now part of the unified Recurring tab.
export default function InstallmentsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/recurring"); }, [router]);
  return null;
}
