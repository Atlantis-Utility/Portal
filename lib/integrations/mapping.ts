/**
 * Turns somebody else's record into a contact.
 *
 * Every system names its fields differently: "Phone", "phone_number",
 * "mobilephone", "Mobile #". Rather than make people map columns before
 * anything works, the common names are recognised automatically, and
 * whatever else the record had is kept in `fields` for later.
 *
 * No imports, so it can be tested on its own.
 */

export interface MappedContact {
  externalId: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  fields: Record<string, unknown>;
}

/** "Phone Number", "phone_number", "PhoneNumber" -> "phonenumber". */
export function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const KEYS = {
  id: ["id", "externalid", "recordid", "contactid", "customerid", "accountid", "key", "hsobjectid", "objectid", "uuid"],
  name: ["name", "fullname", "contactname", "customername", "displayname", "clientname"],
  first: ["firstname", "first", "givenname", "fname"],
  last: ["lastname", "last", "surname", "familyname", "lname"],
  phone: [
    "mobilephone", "mobile", "cell", "cellphone", "mobilenumber", "cellnumber",
    "phone", "phonenumber", "telephone", "tel", "number", "contactnumber", "workphone", "homephone",
  ],
  email: ["email", "emailaddress", "mail", "workemail"],
  company: ["company", "companyname", "business", "businessname", "organization", "organisation", "account", "accountname"],
};

function pick(flat: Record<string, unknown>, names: string[]): string {
  for (const n of names) {
    const v = flat[n];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * Flattens one level of nesting ("properties", "contact", "data") so a
 * HubSpot-shaped or Zapier-shaped record reads the same as a flat one.
 */
function flatten(record: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const take = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = normKey(k);
      if (v && typeof v === "object" && !Array.isArray(v)) continue;
      if (!(key in flat)) flat[key] = v;
    }
  };
  take(record);
  for (const v of Object.values(record)) {
    if (v && typeof v === "object" && !Array.isArray(v)) take(v as Record<string, unknown>);
  }
  return flat;
}

export function mapRecord(record: Record<string, unknown>, fallbackId = ""): MappedContact {
  const flat = flatten(record);
  const first = pick(flat, KEYS.first);
  const last = pick(flat, KEYS.last);
  const name = pick(flat, KEYS.name) || [first, last].filter(Boolean).join(" ");
  const phone = pick(flat, KEYS.phone);
  const email = pick(flat, KEYS.email);
  const company = pick(flat, KEYS.company);
  const externalId =
    pick(flat, KEYS.id) || fallbackId || (phone ? `phone:${phone.replace(/\D/g, "")}` : "") ||
    (email ? `email:${email.toLowerCase()}` : "");
  return { externalId, name, company, email, phone, fields: record };
}

/**
 * A webhook body can be one record, a list, or a wrapper around a list:
 * {"contacts": [...]}, {"data": [...]}, {"records": [...]}.
 */
export function recordsOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const k of ["contacts", "records", "data", "items", "rows", "results"]) {
      if (Array.isArray(obj[k])) return recordsOf(obj[k]);
    }
    return [obj];
  }
  return [];
}

/** A sheet: the first row is headings, the rest are records. */
export function rowsToRecords(values: unknown[][]): Array<{ row: number; record: Record<string, unknown> }> {
  if (!values.length) return [];
  const headings = values[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const out: Array<{ row: number; record: Record<string, unknown> }> = [];
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] ?? [];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue;
    const record: Record<string, unknown> = {};
    headings.forEach((h, j) => { record[h] = cells[j] ?? ""; });
    out.push({ row: i + 1, record });
  }
  return out;
}
