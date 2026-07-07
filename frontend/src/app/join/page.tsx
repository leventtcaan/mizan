"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Referral landing: clarifin.xyz/join?ref=CODE — stash the code so register()
// can send it along, then drop the visitor straight into the register tab.
export default function JoinPage() {
  const router = useRouter();

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && /^[A-Z0-9]{4,12}$/i.test(ref)) {
      localStorage.setItem("mizan_ref", ref.toUpperCase());
    }
    router.replace("/login?mode=register");
  }, [router]);

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <span className="w-6 h-6 border-2 border-line border-t-[#176B5B] rounded-full animate-spin" />
    </div>
  );
}
