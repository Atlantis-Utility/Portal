import { MessageSquare, Workflow, Plug, PhoneCall } from "lucide-react";
import BrandMark from "@/components/ui/BrandMark";

const POINTS = [
  { icon: MessageSquare, title: "Every text, one inbox", body: "Your numbers' conversations, groups and contacts, shared by the team.", tile: "bg-tint-blue text-ink-blue" },
  { icon: Workflow, title: "Automations that run themselves", body: "Reminders and notices, once or on a repeat, sent at the right time.", tile: "bg-tint-violet text-ink-violet" },
  { icon: Plug, title: "Connected to your tools", body: "HubSpot, Google Sheets, Zapier and more, kept in step.", tile: "bg-tint-teal text-ink-teal" },
  { icon: PhoneCall, title: "Your phone system, visible", body: "Numbers, users, calls and billing in one place.", tile: "bg-tint-green text-ink-green" },
];

/**
 * Sign-in and set-password. On a wide screen, a panel on the left says what
 * the portal is; on a phone it's just the form.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-line bg-surface p-12">
        {/* A soft mesh of the app's accent colours. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(36rem 24rem at 0% 0%, color-mix(in srgb, var(--ink-indigo) 16%, transparent), transparent 70%)," +
              "radial-gradient(30rem 22rem at 100% 30%, color-mix(in srgb, var(--ink-violet) 12%, transparent), transparent 70%)," +
              "radial-gradient(34rem 26rem at 30% 110%, color-mix(in srgb, var(--ink-blue) 14%, transparent), transparent 70%)",
          }}
        />
        {/* A faint grid, Vercel-style. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] mask-[radial-gradient(ellipse_at_center,black_40%,transparent_75%)]"
          style={{
            backgroundImage:
              "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <BrandMark size={40} />
          <span>
            <span className="block text-base font-semibold text-fg leading-tight">Atlantis Portal</span>
            <span className="block text-xs text-fg-subtle leading-tight">by Atlantis Utility</span>
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[32px] leading-[1.15] font-semibold tracking-tight text-fg">
            Your communications,{" "}
            <span className="bg-linear-to-r from-ink-indigo via-ink-violet to-ink-blue bg-clip-text text-transparent">
              all in one place.
            </span>
          </h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3.5">
                <span className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${p.tile}`}>
                  <p.icon className="w-4 h-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-fg">{p.title}</span>
                  <span className="block text-[13px] text-fg-muted mt-0.5">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-fg-subtle">Ventura County, California</p>
      </aside>

      <main className="flex items-center justify-center p-4 sm:p-8">{children}</main>
    </div>
  );
}
