import {
  CalendarCheck, CalendarClock, Truck, ClipboardCheck, PhoneMissed, MessageCircleQuestion,
  Receipt, AlarmClock, AlertTriangle, BadgeCheck, CreditCard, FileText, TrendingUp,
  Wrench, Zap, CircleCheck, Router, ArrowRightLeft, Package,
  PartyPopper, Hand, Star, ThumbsUp, RefreshCw, Gift, HeartHandshake,
  Clock, CloudLightning, Building2,
  Users, ClipboardList, Timer, Siren,
  Megaphone, Sparkles, UserPlus,
} from "lucide-react";
import type { Repeat } from "./types";

/**
 * Ready-made workflows: a message and a sensible repeat, to start from.
 *
 * Every template fits what the engine does today - one text, sent once or
 * on a repeat. [Brackets] mark what to fill in before saving. Promotional
 * ones end with an opt-out line, because carriers and the TCPA expect it on
 * anything marketing.
 */
export type TemplateCategory =
  | "Appointments"
  | "Billing"
  | "Service & outages"
  | "Customer care"
  | "Office & hours"
  | "Team"
  | "Promotions";

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "Appointments", "Billing", "Service & outages", "Customer care", "Office & hours", "Team", "Promotions",
];

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  blurb: string;
  icon: React.ElementType;
  text: string;
  repeat: Repeat;
}

export const TEMPLATES: Template[] = [
  // ── Appointments ──
  {
    id: "appt-reminder", category: "Appointments", name: "Appointment reminder", icon: CalendarCheck, repeat: "none",
    blurb: "The day before, with a quick way to confirm.",
    text: "Hi [name], a reminder of your appointment with Atlantis Utility tomorrow at [time]. Reply C to confirm or R to reschedule.",
  },
  {
    id: "appt-same-day", category: "Appointments", name: "Same-day reminder", icon: AlarmClock, repeat: "none",
    blurb: "A short nudge an hour or two before.",
    text: "Hi [name], see you today at [time]. If anything has changed, just reply to this text.",
  },
  {
    id: "appt-confirm", category: "Appointments", name: "Confirm a booking", icon: CalendarClock, repeat: "none",
    blurb: "Lock in a newly booked slot.",
    text: "Your appointment with Atlantis Utility is booked for [date] at [time]. Reply YES to confirm, or call us at [phone] to change it.",
  },
  {
    id: "tech-on-way", category: "Appointments", name: "Technician on the way", icon: Truck, repeat: "none",
    blurb: "Let them know someone is heading over.",
    text: "Hi [name], your technician [tech name] is on the way and should arrive around [time].",
  },
  {
    id: "site-survey", category: "Appointments", name: "Site survey scheduled", icon: ClipboardCheck, repeat: "none",
    blurb: "Before an on-site survey or install.",
    text: "Your site survey is scheduled for [date] at [time]. Please make sure someone can give us access to the network closet.",
  },
  {
    id: "visit-followup", category: "Appointments", name: "After-visit follow-up", icon: MessageCircleQuestion, repeat: "none",
    blurb: "Check everything works after a visit.",
    text: "Hi [name], thanks for having us out today. Is everything working as expected? Reply here if anything needs another look.",
  },
  {
    id: "missed-appt", category: "Appointments", name: "Missed appointment", icon: PhoneMissed, repeat: "none",
    blurb: "Offer a new time after a no-show.",
    text: "Sorry we missed you today, [name]. Reply with a day and time that works and we'll rebook your visit.",
  },

  // ── Billing ──
  {
    id: "pay-reminder", category: "Billing", name: "Payment reminder", icon: Receipt, repeat: "monthly",
    blurb: "A friendly monthly nudge before the due date.",
    text: "Hi [name], a friendly reminder that your Atlantis Utility invoice of [amount] is due on [date]. Questions? Just reply to this text.",
  },
  {
    id: "pay-due-today", category: "Billing", name: "Payment due today", icon: AlarmClock, repeat: "monthly",
    blurb: "On the due date itself.",
    text: "Your Atlantis Utility payment of [amount] is due today. Pay online at [link] or call [phone]. Thank you!",
  },
  {
    id: "pay-overdue", category: "Billing", name: "Overdue notice", icon: AlertTriangle, repeat: "weekly",
    blurb: "A polite weekly reminder while a balance is past due.",
    text: "Hi [name], your balance of [amount] is past due. Please pay at [link] or reply to set up a payment plan, so service isn't interrupted.",
  },
  {
    id: "pay-thanks", category: "Billing", name: "Payment received", icon: BadgeCheck, repeat: "none",
    blurb: "Confirm a payment came through.",
    text: "Thanks, [name]! We've received your payment of [amount]. Your account is all set.",
  },
  {
    id: "card-expiring", category: "Billing", name: "Card expiring / autopay failed", icon: CreditCard, repeat: "none",
    blurb: "Head off a failed charge.",
    text: "Heads up: the card on file for autopay is expiring or was declined. Update it at [link] to avoid a missed payment.",
  },
  {
    id: "statement-ready", category: "Billing", name: "Monthly statement ready", icon: FileText, repeat: "monthly",
    blurb: "On the 1st of each month.",
    text: "Your Atlantis Utility statement for [month] is ready. View it at [link].",
  },
  {
    id: "price-change", category: "Billing", name: "Price change notice", icon: TrendingUp, repeat: "none",
    blurb: "Advance notice of a rate change.",
    text: "Starting [date], the rate for [service] changes to [amount]/month. Questions? Reply here and we'll walk you through it.",
  },

  // ── Service & outages ──
  {
    id: "maintenance", category: "Service & outages", name: "Planned maintenance", icon: Wrench, repeat: "none",
    blurb: "Warn before scheduled work.",
    text: "Heads up: planned maintenance on [date] from [start] to [end] may briefly interrupt your phone service. Thanks for your patience.",
  },
  {
    id: "outage-alert", category: "Service & outages", name: "Outage alert", icon: Zap, repeat: "none",
    blurb: "We know, and we're on it.",
    text: "We're aware of a service outage affecting [area/service] and are working on it now. We'll text you as soon as it's resolved.",
  },
  {
    id: "outage-resolved", category: "Service & outages", name: "Outage resolved", icon: CircleCheck, repeat: "none",
    blurb: "All clear.",
    text: "Good news: the outage affecting [area/service] has been resolved. If anything still isn't working, reply here.",
  },
  {
    id: "service-active", category: "Service & outages", name: "Service activated", icon: Router, repeat: "none",
    blurb: "When a new line or service goes live.",
    text: "Your [service] is now active. Welcome aboard! Reply here any time you need help.",
  },
  {
    id: "port-scheduled", category: "Service & outages", name: "Number port scheduled", icon: ArrowRightLeft, repeat: "none",
    blurb: "Before numbers move over.",
    text: "Your number transfer is scheduled for [date]. Calls may be briefly interrupted that morning; we'll confirm when it's complete.",
  },
  {
    id: "port-complete", category: "Service & outages", name: "Number port complete", icon: BadgeCheck, repeat: "none",
    blurb: "Confirm the move finished.",
    text: "Your numbers have finished transferring to Atlantis Utility. Everything should be working; reply if you notice anything off.",
  },
  {
    id: "equipment-shipped", category: "Service & outages", name: "Equipment shipped", icon: Package, repeat: "none",
    blurb: "Phones or hardware on the way.",
    text: "Your equipment has shipped and should arrive by [date]. Tracking: [link].",
  },

  // ── Customer care ──
  {
    id: "welcome", category: "Customer care", name: "Welcome a new customer", icon: PartyPopper, repeat: "none",
    blurb: "The first text after signing up.",
    text: "Welcome to Atlantis Utility, [name]! Save this number: it's the fastest way to reach our team.",
  },
  {
    id: "first-week", category: "Customer care", name: "First-week check-in", icon: Hand, repeat: "none",
    blurb: "A week after go-live.",
    text: "Hi [name], it's been a week since we set you up. How's everything going? Anything we can tweak?",
  },
  {
    id: "weekly-checkin", category: "Customer care", name: "Weekly check-in", icon: RefreshCw, repeat: "weekly",
    blurb: "A standing weekly message to a person or group.",
    text: "Hi! Just checking in for the week. Anything we can help with? Reply here any time.",
  },
  {
    id: "survey", category: "Customer care", name: "Satisfaction survey", icon: ThumbsUp, repeat: "none",
    blurb: "One quick question.",
    text: "How likely are you to recommend Atlantis Utility to a friend, from 0 to 10? Just reply with a number.",
  },
  {
    id: "review", category: "Customer care", name: "Review request", icon: Star, repeat: "none",
    blurb: "Ask a happy customer for a review.",
    text: "Thanks for choosing Atlantis Utility, [name]! If we've done a good job, we'd really appreciate a quick review: [link]",
  },
  {
    id: "renewal", category: "Customer care", name: "Contract renewal", icon: CalendarClock, repeat: "none",
    blurb: "Ahead of a renewal date.",
    text: "Your Atlantis Utility agreement renews on [date]. Want to review your plan first? Reply and we'll set up a quick call.",
  },
  {
    id: "anniversary", category: "Customer care", name: "Customer anniversary", icon: HeartHandshake, repeat: "none",
    blurb: "Celebrate a year together.",
    text: "Happy anniversary, [name]! It's been [years] with Atlantis Utility. Thank you for trusting us with your communications.",
  },

  // ── Office & hours ──
  {
    id: "holiday", category: "Office & hours", name: "Holiday closure", icon: PartyPopper, repeat: "none",
    blurb: "When the office is closed.",
    text: "Our office will be closed on [date] for [holiday]. For urgent service issues, reply URGENT and we'll get back to you.",
  },
  {
    id: "hours-change", category: "Office & hours", name: "Office hours change", icon: Clock, repeat: "none",
    blurb: "New or seasonal hours.",
    text: "Starting [date], our office hours are [days], [open] to [close]. Texts are answered during those hours.",
  },
  {
    id: "weather", category: "Office & hours", name: "Weather or emergency closure", icon: CloudLightning, repeat: "none",
    blurb: "Unplanned closures.",
    text: "Due to [reason], our office is closed today. Support is still available by text for urgent issues.",
  },
  {
    id: "office-move", category: "Office & hours", name: "Office moving", icon: Building2, repeat: "none",
    blurb: "New address notice.",
    text: "We're moving! Starting [date], you'll find us at [address]. Your service and this number stay the same.",
  },

  // ── Team (internal) ──
  {
    id: "standup", category: "Team", name: "Daily stand-up reminder", icon: Users, repeat: "weekdays",
    blurb: "Every weekday morning, to the team.",
    text: "Stand-up in 10 minutes. Have your updates ready.",
  },
  {
    id: "weekly-report", category: "Team", name: "Weekly report due", icon: ClipboardList, repeat: "weekly",
    blurb: "A Friday reminder.",
    text: "Reminder: weekly reports are due by end of day today.",
  },
  {
    id: "timesheet", category: "Team", name: "Timesheet reminder", icon: Timer, repeat: "weekly",
    blurb: "Before payroll closes.",
    text: "Please submit your timesheet for this week by [time] today.",
  },
  {
    id: "on-call", category: "Team", name: "On-call hand-off", icon: Siren, repeat: "weekly",
    blurb: "Who's on call this week.",
    text: "You're on call starting today through [date]. Escalations go to [phone].",
  },

  // ── Promotions (opt-in contacts only) ──
  {
    id: "promo", category: "Promotions", name: "Special offer", icon: Gift, repeat: "none",
    blurb: "A limited-time offer.",
    text: "[Offer] for Atlantis Utility customers through [date]. Reply YES to learn more. Reply STOP to opt out.",
  },
  {
    id: "new-service", category: "Promotions", name: "New service announcement", icon: Sparkles, repeat: "none",
    blurb: "Tell customers about something new.",
    text: "New from Atlantis Utility: [service]. Want details? Reply INFO. Reply STOP to opt out.",
  },
  {
    id: "referral", category: "Promotions", name: "Referral program", icon: UserPlus, repeat: "none",
    blurb: "Reward a recommendation.",
    text: "Know a business that needs better phones or internet? Refer them and get [reward] when they sign up. Reply REFER for details. Reply STOP to opt out.",
  },
  {
    id: "announcement", category: "Promotions", name: "General announcement", icon: Megaphone, repeat: "none",
    blurb: "News to share with everyone.",
    text: "[Your announcement]. Reply here with any questions. Reply STOP to opt out.",
  },
];
