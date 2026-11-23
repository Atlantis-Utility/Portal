"use client";

import { formatPhone } from "@/lib/utils";

/**
 * Saves a contact into a RingLogix contact book, asking first if it would
 * replace somebody.
 *
 * RingLogix matches contacts BY NAME when creating one: a second "John
 * Smith" in the same book doesn't add an entry, it overwrites the first
 * one's details. The route refuses that with a 409 naming who is there;
 * this turns the refusal into a question and only overwrites on a yes.
 */
export interface ContactFields {
  user: string;
  first_name: string;
  last_name: string;
  company?: string;
  work_phone?: string;
  cell_phone?: string;
  home_phone?: string;
  email?: string;
}

type Confirm = (opts: { title: string; description: string; confirmLabel?: string }) => Promise<boolean>;

export async function saveContact(
  fields: ContactFields,
  confirm: Confirm,
): Promise<{ ok: true; replaced: boolean } | { ok: false; canceled?: boolean; error?: string }> {
  const post = (replace: boolean) =>
    fetch("/api/ringlogix/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, replace }),
    });

  let res = await post(false);
  let replaced = false;
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as {
      existing?: { name?: string; book?: string; phone?: string; company?: string };
    };
    const e = data.existing ?? {};
    const details = [e.phone ? formatPhone(e.phone) || e.phone : "", e.company].filter(Boolean).join(" · ");
    const ok = await confirm({
      title: `Replace ${e.name ?? "this contact"}?`,
      description:
        `There's already a ${e.name ?? "contact with this name"} in ${e.book ?? "this contact book"}` +
        `${details ? ` (${details})` : ""}. RingLogix keeps one contact per name, so saving replaces their ` +
        `details with these. To keep both, use a different name.`,
      confirmLabel: "Replace",
    });
    if (!ok) return { ok: false, canceled: true };
    res = await post(true);
    replaced = true;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    return { ok: false, error: data.message ?? data.error ?? "Couldn't save that contact" };
  }
  return { ok: true, replaced };
}
