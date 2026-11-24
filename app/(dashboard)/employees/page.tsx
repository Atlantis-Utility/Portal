"use client";

import { useState, useEffect } from "react";
import { usePolling } from "@/lib/use-polling";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import ExportMenu from "@/components/ui/ExportMenu";
import { subscribeEmployees } from "@/lib/db/employees";
import { getAvatarColor, getInitials, formatDate } from "@/lib/utils";
import { Search, Plus, CheckCircle2, Clock, CircleDashed, Send, RefreshCw } from "lucide-react";
import type { Employee, EmployeeStatus } from "@/lib/mock-data";
import AddEmployeeDrawer from "@/components/employees/AddEmployeeDrawer";
import Select from "@/components/ui/Select";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast";
import { loginState, sendInvite, type SignInStatus } from "@/lib/invites";

const statusConfig: Record<EmployeeStatus, { label: string; bg: string; text: string; dot: string }> = {
  active: {
    label: "Active",
    bg: "bg-[#e8fdf0]",
    text: "text-[#17c964]",
    dot: "bg-[#17c964]",
  },
  remote: {
    label: "Remote",
    bg: "bg-[#e8f2ff]",
    text: "text-[#0070f3]",
    dot: "bg-[#0070f3]",
  },
  "on-leave": {
    label: "On Leave",
    bg: "bg-[#fff8e6]",
    text: "text-[#f5a524]",
    dot: "bg-[#f5a524]",
  },
};

const allStatuses: Array<"All Statuses" | EmployeeStatus> = [
  "All Statuses",
  "active",
  "remote",
  "on-leave",
];

export default function EmployeesPage() {
  const router = useRouter();
  // Painted from the last visit's copy while the live list arrives. Safe to
  // read during the first render: AuthGuard means this never hydrates.
  const { authUser } = useAuth();
  const toast = useToast();
  // Only administrators can send invites (the route checks too).
  const canInvite = Boolean(authUser?.isUnrestricted);
  // Who has actually signed in, from Supabase Auth (server-side read).
  const [logins, setLogins] = useState<Record<string, SignInStatus> | null>(null);
  const [loginsVersion, setLoginsVersion] = useState(0);
  const [inviting, setInviting] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/employees/sign-in-status", { cache: "no-store" });
        const data = await res.json();
        if (alive && res.ok) setLogins(data.users ?? {});
      } catch {
        // Without it the column just says nothing yet.
      }
    })();
    return () => { alive = false; };
  }, [loginsVersion]);
  // Someone accepting their invite turns Pending into Active by itself.
  usePolling(() => setLoginsVersion((v) => v + 1), 30_000);

  async function invite(emp: Employee) {
    setInviting(emp.id);
    const sent = await sendInvite(emp.email);
    setInviting(null);
    if (sent.ok) toast.success(sent.message);
    else toast.error(sent.message);
    setLoginsVersion((v) => v + 1);
  }

  const [employees, setEmployees] = useState<Employee[]>(() => {
    try { return JSON.parse(localStorage.getItem("sc:employees") ?? "[]"); } catch { return []; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<"All Statuses" | EmployeeStatus>(
    "All Statuses"
  );

  useEffect(() => {
    const unsub = subscribeEmployees((emps) => {
      setEmployees(emps);
      try { localStorage.setItem("sc:employees", JSON.stringify(emps)); } catch {}
    });
    return unsub;
  }, []);

  const exportData = () => ({
    filename: "employees",
    title: "Users",
    headers: ["Name", "Email", "Role", "Access", "Status", "Location", "Start Date"],
    rows: filtered.map((emp) => [
      emp.name, emp.email ?? "", emp.role ?? "", emp.accessRole ?? "", emp.status ?? "",
      emp.location ?? "", emp.startDate ?? "",
    ]),
  });

  const filtered = employees.filter((emp) => {
    const matchesSearch =
      // Fields can be missing on a record added elsewhere; search what's there.
      (emp.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (emp.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (emp.role ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      selectedStatus === "All Statuses" || emp.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <Header
        title="Users"
        subtitle={`${employees.length} team members`}
        actions={
          <>
            <ExportMenu data={exportData} disabled={filtered.length === 0} />
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 bg-[#0a0a0a] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#333] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add User
            </button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-52 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#999]" />
          <input
            type="text"
            placeholder="Search by name, email, or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-[#eaeaea] rounded-lg pl-9 pr-3 py-2 text-sm text-[#0a0a0a] placeholder:text-[#999] focus:outline-none focus:border-[#0070f3] transition-colors"
          />
        </div>

        <div className="w-40">
          <Select
            value={selectedStatus}
            onChange={(v) => setSelectedStatus(v as "All Statuses" | EmployeeStatus)}
            options={allStatuses.map((s) => ({
              value: s,
              label: s === "on-leave" ? "On Leave" : s.charAt(0).toUpperCase() + s.slice(1),
            }))}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#eaeaea] rounded-xl overflow-x-auto">
        <table className="w-full min-w-180">
          <thead>
            <tr className="border-b border-[#eaeaea] bg-[#fafafa]">
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                User
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Role
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Access
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Status
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Login
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Location
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Start Date
              </th>
              <th className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wider px-3 py-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-[#999] py-12">
                  {employees.length === 0 ? "Loading employees..." : "No employees match your search."}
                </td>
              </tr>
            ) : (
              filtered.map((emp) => {
                const colors = getAvatarColor(emp.name);
                // A status this page doesn't know (e.g. "Active" written by another
                // tool) must not take the whole page down.
                const status = statusConfig[emp.status] ?? statusConfig[String(emp.status ?? "").toLowerCase() as EmployeeStatus] ?? statusConfig.active;
                return (
                  <tr
                    key={emp.id}
                    className="border-b border-[#f7f7f7] last:border-0 hover:bg-[#fafafa] cursor-pointer transition-colors"
                    onClick={() => router.push(`/employees/${emp.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full ${colors.bg} ${colors.text} flex items-center justify-center shrink-0`}
                        >
                          <span className="text-xs font-semibold">
                            {getInitials(emp.name)}
                          </span>
                        </div>
                        <div className="min-w-0 max-w-[15rem]">
                          <p className="text-sm font-medium text-[#0a0a0a] truncate">{emp.name}</p>
                          <p className="text-xs text-[#999] truncate" title={emp.email}>{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-sm text-[#444] truncate max-w-[12rem]" title={emp.role}>{emp.role || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-[#f5f5f5] text-[#444] whitespace-nowrap">
                        {emp.accessRole ?? "Contributor"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${status.bg} ${status.text}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <LoginCell
                        state={logins ? loginState(logins[(emp.email ?? "").toLowerCase()]) : null}
                        info={logins?.[(emp.email ?? "").toLowerCase()]}
                        canInvite={canInvite}
                        busy={inviting === emp.id}
                        onInvite={() => invite(emp)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-sm text-[#666] truncate max-w-[9rem]" title={emp.location}>{emp.location || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#666] whitespace-nowrap tabular-nums">{formatDate(emp.startDate)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/employees/${emp.id}`);
                        }}
                        className="text-xs font-medium border border-[#eaeaea] text-[#444] px-3 py-1.5 rounded-lg hover:bg-[#f5f5f5] hover:border-[#d4d4d4] transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[#999] mt-3">
        Showing {filtered.length} of {employees.length} employees
      </p>

      <AddEmployeeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onAdded={() => setLoginsVersion((v) => v + 1)}
      />
    </div>
  );
}

/**
 * Whether this person can actually get in: signed in at least once, invited
 * and still pending, or never invited.
 */
function LoginCell({
  state, info, canInvite, busy, onInvite,
}: {
  state: ReturnType<typeof loginState> | null;
  info?: SignInStatus;
  canInvite: boolean;
  busy: boolean;
  onInvite: () => void;
}) {
  // Taken once per row; "2h ago" doesn't need to tick.
  const [now] = useState(() => Date.now());
  if (state === null) return <span className="inline-block w-24 h-6 rounded-full bg-surface-3 animate-pulse" />;
  // "2h ago", "Nov 22": short enough to sit on the same line as the status.
  const since = (iso: string | null | undefined) => {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    const m = Math.round((now - ms) / 60_000);
    if (m < 60) return m <= 1 ? "just now" : `${m}m ago`;
    if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
    if (m < 60 * 24 * 7) return `${Math.round(m / 1440)}d ago`;
    return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const pill = (tone: string, Icon: typeof CheckCircle2, text: string) => (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium pl-1.5 pr-2.5 py-1 rounded-full ${tone}`}>
      <Icon className="w-3.5 h-3.5" /> {text}
    </span>
  );
  const action = (label: string) =>
    canInvite && (
      <button
        onClick={onInvite}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border border-line bg-surface px-2.5 py-1 text-fg hover:bg-surface-3 hover:border-line-strong transition-colors disabled:opacity-50"
      >
        {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        {busy ? "Sending" : label}
      </button>
    );

  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {state === "active" ? (
        <>
          {pill("bg-tint-green text-ink-green", CheckCircle2, "Signed in")}
          {info?.lastSignInAt && <span className="text-[11px] text-fg-subtle" title={new Date(info.lastSignInAt).toLocaleString()}>{since(info.lastSignInAt)}</span>}
        </>
      ) : state === "pending" ? (
        <>
          {pill("bg-tint-amber text-ink-amber", Clock, "Invited")}
          {info?.invitedAt && <span className="text-[11px] text-fg-subtle">{since(info.invitedAt)}</span>}
          {action("Resend")}
        </>
      ) : (
        <>
          {pill("bg-surface-3 text-fg-muted", CircleDashed, "No login")}
          {action("Invite")}
        </>
      )}
    </div>
  );
}
