"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The backdrop a modal sits on, which dismisses it.
 *
 * Twelve of the app's nineteen overlays had no way out but their own X, so
 * clicking beside one did nothing and Escape did nothing. Both are reflexes,
 * and a dialog that ignores them feels stuck.
 *
 * Rendered into <body>, not where it's used. The shell puts page content in
 * its own layer beneath the top bar and sidebar, and a modal opened inside a
 * page inherited that: the bar and sidebar drew over it, cutting off its
 * header. From <body> it sits above everything, whoever opens it.
 *
 * The click test is `target === currentTarget`, so only the backdrop itself
 * counts. The alternative, stopping propagation on the panel, breaks
 * anything inside that legitimately listens on the document, which in this
 * app includes every Select and date picker.
 */
export default function Overlay({
  onDismiss,
  className,
  children,
  dismissable = true,
}: {
  onDismiss: () => void;
  /** The backdrop's own classes, so each modal keeps its own look. */
  className: string;
  children: ReactNode;
  /**
   * False while something is mid-flight, so a stray click can't close a
   * dialog that is busy writing.
   */
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!dismissable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss, dismissable]);

  const layer = (
    <div
      className={className}
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}
