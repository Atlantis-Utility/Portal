"use client";

import type { ReactNode } from "react";
import { usePhone } from "./PhoneProvider";

/**
 * A phone number you can click. With the portal phone (an extension set
 * in Edit Profile) it rings from the browser; without one it stays the
 * plain tel: link it always was, which hands off to the computer's own
 * calling app.
 */
export default function CallLink({
  number, name, className, children, tip,
}: { number: string; name?: string; className?: string; children: ReactNode; tip?: string }) {
  const phone = usePhone();
  const digits = number.replace(/\D/g, "");
  return (
    <a
      href={`tel:+${digits}`}
      data-tip={tip ?? (phone ? "Call from the portal" : undefined)}
      className={className}
      onClick={(e) => {
        if (!phone) return;
        e.preventDefault();
        // Opens the phone either way; it only dials when it's free and
        // connected, and otherwise shows why it can't.
        phone.dial(digits, name);
      }}
    >
      {children}
    </a>
  );
}
