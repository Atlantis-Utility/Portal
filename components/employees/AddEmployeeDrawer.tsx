"use client";

import { useState, useEffect, useRef } from "react";
import DateTimePicker from "@/components/ui/DateTimePicker";
import Drawer from "@/components/ui/Drawer";
import { addNotification } from "@/lib/notifications";
import { logActivity } from "@/lib/activity-log";
import FormField, { inputClass } from "@/components/ui/FormField";
import Select from "@/components/ui/Select";
import { addEmployee } from "@/lib/db/employees";
import { sendInvite } from "@/lib/invites";
import { useToast } from "@/lib/toast";
import type { Employee, EmployeeStatus, AccessRole } from "@/lib/mock-data";

interface Props {
  open: boolean;
  onClose: () => void;
  /** After a user is saved, so the list can refresh who's pending. */
  onAdded?: () => void;
}

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  role: "",
  accessRole: "Contributor" as AccessRole,
  status: "active" as EmployeeStatus,
  location: "",
  startDate: new Date().toISOString().split("T")[0],
};

type FormErrors = Partial<Record<keyof typeof emptyForm, string>>;

export default function AddEmployeeDrawer({ open, onClose, onAdded }: Props) {
  const toast = useToast();
  // On by default: a user who is added but never told can't sign in, and
  // stays "Pending" on the Users page until they do.
  const [invite, setInvite] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (saveError || Object.keys(errors).length > 0) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [saveError, errors]);

  function set(field: keyof typeof emptyForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (saveError) setSaveError("");
  }

  function validate(): boolean {
    const errs: FormErrors = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email address";
    if (!form.phone.trim()) errs.phone = "Phone is required";
    if (!form.role.trim()) errs.role = "Role is required";
    if (!form.location.trim()) errs.location = "Location is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setSaveError("");
    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      role: form.role.trim(),
      accessRole: form.accessRole,
      status: form.status,
      startDate: form.startDate,
      location: form.location.trim(),
      skills: [],
      salary: 0,
      access: [],
    };
    try {
      await addEmployee(newEmp);
    } catch (err) {
      console.error("[AddEmployeeDrawer] Failed to add employee:", err instanceof Error ? err.message : err);
      setSaveError(err instanceof Error ? err.message : "Failed to save. Please try again.");
      setSaving(false);
      return;
    }

    // The database write already succeeded — these are best-effort local
    // mirrors/notifications, so a failure here must not be reported as "the
    // save failed" or block the drawer from closing.
    try {
      addNotification({
        prefId: "n-1",
        icon: "user",
        title: "New hire added",
        body: `${newEmp.name} joined as ${newEmp.role}`,
        href: `/employees/${newEmp.id}`,
      });
      logActivity({
        category: "employees",
        action: "User added",
        detail: `Added ${newEmp.name} as ${newEmp.role} in ${newEmp.location}`,
        metadata: { employeeId: newEmp.id, role: newEmp.role, status: newEmp.status },
      });
    } catch (err) {
      console.error("[AddEmployeeDrawer] Post-save side effect failed (employee was added):", err instanceof Error ? err.message : err);
    }
    // The user is saved either way; the invite is reported on its own, so
    // "added, but the email didn't go" reads as exactly that.
    if (invite) {
      const sent = await sendInvite(newEmp.email);
      if (sent.ok) toast.success(`${newEmp.name} added. ${sent.message}`);
      else toast.error(`${newEmp.name} added, but the invite wasn't sent. ${sent.message} You can resend it from the Users list.`);
    } else {
      toast.success(`${newEmp.name} added. They show as not invited until you send one.`);
    }

    setForm(emptyForm);
    setErrors({});
    setSaveError("");
    setSaving(false);
    onAdded?.();
    onClose();
  }

  function handleClose() {
    setForm(emptyForm);
    setErrors({});
    setSaveError("");
    onClose();
  }


  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Add User"
      subtitle="Fill in the details to add a new team member"
      footer={
        <>
          <button
            onClick={handleClose}
            className="border border-[#eaeaea] bg-white text-sm font-medium text-[#444] px-4 py-2 rounded-lg hover:bg-[#fafafa] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#0a0a0a] text-white text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : invite ? "Add and invite" : "Add User"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div ref={errorRef} />
        {saveError && (
          <div className="bg-[#fff5f5] border border-[#fecaca] text-[#dc2626] text-sm px-4 py-3 rounded-lg">
            {saveError}
          </div>
        )}

        <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-3">Basic Information</p>

        <FormField label="Full Name" required error={errors.name}>
          <input
            className={inputClass}
            placeholder="e.g. Jordan Smith"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Email" required error={errors.email}>
            <input
              className={inputClass}
              placeholder="jordan@atlantis.io"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </FormField>
          <FormField label="Phone" required error={errors.phone}>
            <input
              className={inputClass}
              placeholder="+1 (415) 555-0100"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </FormField>
        </div>

        <div className="border-t border-[#f7f7f7] pt-4">
          <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-3">Role</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Job Title / Role" required error={errors.role}>
            <input
              className={inputClass}
              placeholder="e.g. Senior Software Engineer"
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
            />
          </FormField>
          <FormField label="Status" error={errors.status}>
            <Select
              value={form.status}
              onChange={(v) => set("status", v)}
              options={[
                { value: "active", label: "Active" },
                { value: "remote", label: "Remote" },
                { value: "on-leave", label: "On Leave" },
              ]}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Access Role" hint="Workspace permissions">
            <Select
              value={form.accessRole}
              onChange={(v) => set("accessRole", v)}
              options={[
                { value: "Administrator", label: "Administrator: Full access" },
                { value: "Manager", label: "Manager: Manage teams & projects" },
                { value: "Analyst", label: "Analyst: View & export data" },
                { value: "Contributor", label: "Contributor: Add & edit content" },
                { value: "Viewer", label: "Viewer: Read only" },
              ]}
            />
          </FormField>
          <FormField label="Start Date" error={errors.startDate}>
            <DateTimePicker
              value={form.startDate}
              onChange={(v) => set("startDate", v)}
              dateOnly
              floating
              placeholder="Pick a start date"
            />
          </FormField>
        </div>

        <div className="border-t border-[#f7f7f7] pt-4">
          <p className="text-[10px] font-semibold text-[#999] uppercase tracking-widest mb-3">Location</p>
        </div>

        <FormField label="Location" required error={errors.location}>
          <input
            className={inputClass}
            placeholder="San Francisco, CA"
            value={form.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </FormField>

        <label className="flex items-start gap-3 rounded-xl border border-[#eaeaea] bg-[#fafafa] p-3.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-[#0a0a0a]">Email them an invite</span>
            <span className="block text-xs text-[#666] mt-0.5">
              They get a link to set a password (valid 24 hours) and show as Pending until they sign in.
              Anyone in the Atlantis Microsoft account can also just use “Continue with Microsoft”.
            </span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}
