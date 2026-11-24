/** Someone the portal phone can call: a RingLogix contact or a colleague. */
export interface DirectoryEntry {
  id: string;
  name: string;
  /** Company for a contact, "Extension 104" for a colleague. */
  detail: string;
  kind: "contact" | "colleague";
  numbers: Array<{ label: string; number: string }>;
}

/** The entry with this number: the last ten digits, or an exact extension. */
export function whoHas(entries: DirectoryEntry[], number: string): DirectoryEntry | null {
  const d = number.replace(/\D/g, "");
  if (!d) return null;
  const key = d.length >= 10 ? d.slice(-10) : d;
  return entries.find((e) => e.numbers.some((n) => (n.number.length >= 10 ? n.number.slice(-10) : n.number) === key)) ?? null;
}

/** The portal phone's Recents and Voicemail, for your own extension. */
export interface Recents {
  extension: string;
  calls: import("@/lib/inbox").CallRecord[];
  voicemails: import("@/lib/inbox").Voicemail[];
  unavailable: string[];
  loadedAt: number;
}
