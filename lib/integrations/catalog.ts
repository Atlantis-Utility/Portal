/**
 * Every system the Integrations page knows about.
 *
 * Shared by the browser and the server. A provider is "available" once it
 * has a connector in lib/integrations/providers; the rest are listed so
 * people can see what's planned and reach them meanwhile through a webhook
 * (most CRMs can call one) or Zapier / Make / n8n.
 */

export type ProviderId =
  | "hubspot"
  | "google_sheets"
  | "webhook_in"
  | "webhook_out"
  // Planned:
  | "salesforce" | "zoho" | "pipedrive" | "freshsales" | "activecampaign" | "copper"
  | "gohighlevel" | "monday" | "airtable" | "calendly" | "quickbooks" | "stripe"
  | "dynamics" | "zapier" | "make" | "n8n";

export type ProviderCategory = "CRM" | "Spreadsheets" | "Webhooks & automation" | "Scheduling" | "Billing";

/** A field the person fills in to connect. */
export interface ConnectField {
  key: string;
  label: string;
  /** Secret fields are encrypted and never shown again. */
  secret?: boolean;
  multiline?: boolean;
  placeholder?: string;
  help?: string;
  optional?: boolean;
}

export interface Provider {
  id: ProviderId;
  label: string;
  category: ProviderCategory;
  blurb: string;
  available: boolean;
  /** What to fill in to connect. Empty for providers that need none. */
  fields: ConnectField[];
  /** Whether it brings contacts in on a schedule. */
  syncs: boolean;
  /** How to get the credential, for the connect form. */
  howTo?: string[];
}

const syncMinutesField: ConnectField = {
  key: "syncMinutes",
  label: "Sync every (minutes)",
  placeholder: "60",
  help: "0 turns automatic syncing off; you can still sync by hand.",
  optional: true,
};

export const PROVIDERS: Provider[] = [
  {
    id: "hubspot",
    label: "HubSpot",
    category: "CRM",
    blurb: "Bring HubSpot contacts in, so texts from their numbers show who they are.",
    available: true,
    syncs: true,
    fields: [
      {
        key: "token",
        label: "Private app access token",
        secret: true,
        placeholder: "pat-na1-…",
        help: "Needs the crm.objects.contacts.read scope.",
      },
      syncMinutesField,
    ],
    howTo: [
      "In HubSpot: Settings → Integrations → Private Apps → Create a private app.",
      "Scopes: tick crm.objects.contacts.read (and crm.objects.companies.read if you like).",
      "Create it, then copy the access token and paste it here.",
    ],
  },
  {
    id: "google_sheets",
    label: "Google Sheets",
    category: "Spreadsheets",
    blurb: "Read people from a sheet: a contact list, a billing list, an appointment schedule.",
    available: true,
    syncs: true,
    fields: [
      {
        key: "serviceAccount",
        label: "Service account key (JSON)",
        secret: true,
        multiline: true,
        placeholder: "{ \"type\": \"service_account\", … }",
        help: "Set up once by an administrator. Each sheet is then shared with the account's email.",
      },
      {
        key: "sheetUrl",
        label: "Sheet link",
        placeholder: "https://docs.google.com/spreadsheets/d/…",
      },
      {
        key: "range",
        label: "Tab name",
        placeholder: "Sheet1",
        optional: true,
        help: "The first row must be headings. Columns named like Name, Phone, Email and Company are found automatically.",
      },
      syncMinutesField,
    ],
    howTo: [
      "In Google Cloud Console: create a project, enable the Google Sheets API.",
      "IAM & Admin → Service Accounts → create one → Keys → Add key → JSON. Paste the file's contents here.",
      "Share your sheet with the service account's email (it ends in .iam.gserviceaccount.com), as Viewer.",
    ],
  },
  {
    id: "webhook_in",
    label: "Incoming webhook",
    category: "Webhooks & automation",
    blurb: "A private URL any system can send contacts or events to: Zapier, Make, n8n, or a CRM's own workflow rules.",
    available: true,
    syncs: false,
    fields: [],
  },
  {
    id: "webhook_out",
    label: "Outgoing webhook",
    category: "Webhooks & automation",
    blurb: "Tell another system when things happen here, such as a scheduled text running.",
    available: true,
    syncs: false,
    fields: [
      { key: "url", label: "Send events to (URL)", placeholder: "https://hooks.zapier.com/…" },
      {
        key: "signingSecret",
        label: "Signing secret",
        secret: true,
        optional: true,
        help: "If set, each request carries an X-Portal-Signature header (HMAC-SHA256 of the body) to prove it came from here.",
      },
    ],
  },
  // ── Planned ──
  ...([
    ["salesforce", "Salesforce", "CRM"],
    ["zoho", "Zoho CRM", "CRM"],
    ["pipedrive", "Pipedrive", "CRM"],
    ["freshsales", "Freshsales", "CRM"],
    ["activecampaign", "ActiveCampaign", "CRM"],
    ["copper", "Copper", "CRM"],
    ["gohighlevel", "GoHighLevel", "CRM"],
    ["dynamics", "Microsoft Dynamics 365", "CRM"],
    ["monday", "Monday CRM", "CRM"],
    ["airtable", "Airtable", "Spreadsheets"],
    ["calendly", "Calendly", "Scheduling"],
    ["quickbooks", "QuickBooks", "Billing"],
    ["stripe", "Stripe", "Billing"],
    ["zapier", "Zapier", "Webhooks & automation"],
    ["make", "Make", "Webhooks & automation"],
    ["n8n", "n8n", "Webhooks & automation"],
  ] as const).map(([id, label, category]): Provider => ({
    id,
    label,
    category,
    blurb: ["zapier", "make", "n8n"].includes(id)
      ? "Works today: point it at an incoming webhook, or add an outgoing webhook with its URL."
      : "Coming. Meanwhile, most can call an incoming webhook from their own workflow rules.",
    available: false,
    syncs: false,
    fields: [],
  })),
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Events an outgoing webhook can be told about. */
export const OUTGOING_EVENTS = [
  { key: "workflow.run", label: "A scheduled text ran" },
  { key: "contacts.synced", label: "A sync finished" },
  { key: "webhook.received", label: "An incoming webhook was received" },
] as const;
export type OutgoingEvent = (typeof OUTGOING_EVENTS)[number]["key"];

/** What the Integrations page gets for one connection. Never the secret. */
export interface IntegrationView {
  id: string;
  provider: ProviderId;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  hasSecret: boolean;
  lastSyncAt: string | null;
  lastStatus: "never" | "ok" | "error";
  lastError: string;
  contactCount: number;
  createdByName: string;
  createdAt: string;
}

export interface IntegrationEvent {
  id: string;
  at: string;
  kind: string;
  ok: boolean;
  summary: string;
}
