import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { buildSalesWorkQueue } from "@/lib/sales-work-queue.js";
import { buildSalesAuditTimeline } from "@/lib/sales-audit-timeline.js";
import { buildSalesFunnelMetrics } from "@/lib/sales-funnel-metrics.js";
import {
  companyNameKey,
  prepareSalesBulkImport,
  MAX_SALES_BULK_IMPORT_LENGTH,
} from "@/lib/sales-bulk-import.js";
import { salesEmailRecipient } from "@/lib/sales-email-export.js";
import {
  MAX_SALES_REPLIES_WITH_OPT_OUT,
  requiresOptOutOnlyReplyIntake,
  salesReplyIntakeDefaultChannel,
} from "@/lib/sales-reply-history.js";
import {
  completeSalesResearch,
  saveSalesOutreachDraft,
  approveSalesOutreachDraft,
  saveSalesReplyDraft,
  approveSalesReplyDraft,
  recordSalesReplyDelivery,
  saveSalesFollowUpDraft,
  approveSalesFollowUpDraft,
  recordSalesFollowUpDelivery,
  saveSalesMeetingOptions,
  approveSalesMeetingOptions,
  recordSalesMeetingOptionsDelivery,
  confirmSalesAppointment,
  prepareSalesAppointmentNotice,
  approveSalesAppointmentNotice,
  recordSalesAppointmentNoticeDelivery,
  prepareSalesAppointmentReminder,
  approveSalesAppointmentReminder,
  recordSalesAppointmentReminderDelivery,
  recordSalesAppointmentOutcome,
  scheduleSalesPostMeetingFollowUp,
  completeSalesPostMeetingFollowUp,
  recordSalesOutreachDelivery,
  recordSalesReply,
  createSalesLeadRecord,
  updateSalesLeadProfile,
  parseSalesLeadRecord,
  SALES_LEAD_RECORD_PREFIX,
} from "@/lib/sales-lead-record.js";

type SalesTask = {
  id: string;
  content: string | null;
  updated_at: string;
};

async function recordInboundReply(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64) redirect("/sales?notice=reply-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesReply(id, task.content, {
    channel: formData.get("channel"),
    type: formData.get("type"),
    message: formData.get("message"),
  }, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=reply-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=reply-recorded");
}

async function recordOutreachDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const channel = formData.get("channel");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (channel !== "EMAIL" && channel !== "LINE")
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesOutreachDelivery(
    id, task.content, user.id, new Date().toISOString(), channel,
  );
  if (!content) redirect("/sales?notice=delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=delivery-recorded");
}

async function reviewOutreach(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "save" && operation !== "approve")) redirect("/sales?notice=outreach-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  if (operation === "approve" && formData.get("confirmed") !== "yes")
    redirect("/sales?notice=outreach-invalid");
  const content = operation === "save"
    ? saveSalesOutreachDraft(id, task.content, {
      subject: formData.get("subject"), body: formData.get("body"), signature: formData.get("signature"),
    })
    : approveSalesOutreachDraft(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=outreach-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "save" ? "/sales?notice=draft-saved" : "/sales?notice=draft-approved");
}

async function reviewReplyDraft(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "save" && operation !== "approve")) redirect("/sales?notice=reply-draft-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  if (operation === "approve" && formData.get("confirmed") !== "yes")
    redirect("/sales?notice=reply-draft-invalid");
  const content = operation === "save"
    ? saveSalesReplyDraft(id, task.content, {
      subject: formData.get("subject"), body: formData.get("body"), signature: formData.get("signature"),
    })
    : approveSalesReplyDraft(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=reply-draft-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "save" ? "/sales?notice=reply-draft-saved" : "/sales?notice=reply-draft-approved");
}

async function recordReplyDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=reply-delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesReplyDelivery(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=reply-delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=reply-delivery-recorded");
}

async function reviewFollowUpDraft(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "save" && operation !== "approve")) redirect("/sales?notice=follow-up-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  if (operation === "approve" && formData.get("confirmed") !== "yes")
    redirect("/sales?notice=follow-up-invalid");
  const now = new Date().toISOString();
  const content = operation === "save"
    ? saveSalesFollowUpDraft(id, task.content, {
      subject: formData.get("subject"), body: formData.get("body"),
    }, user.id, now)
    : approveSalesFollowUpDraft(id, task.content, user.id, now);
  if (!content) redirect("/sales?notice=follow-up-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "save" ? "/sales?notice=follow-up-saved" : "/sales?notice=follow-up-approved");
}

async function recordFollowUpDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=follow-up-delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesFollowUpDelivery(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=follow-up-delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=follow-up-delivery-recorded");
}

async function reviewMeetingOptions(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "save" && operation !== "approve")) redirect("/sales?notice=meeting-options-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  if (operation === "approve" && formData.get("confirmed") !== "yes")
    redirect("/sales?notice=meeting-options-invalid");
  const savedAt = new Date().toISOString();
  const slots = ["option1", "option2", "option3"].map((name) => {
    const value = String(formData.get(name) ?? "");
    return value === "" ? "" : (jstLocalToIso(value) ?? "INVALID");
  });
  const durationMinutes = Number(formData.get("durationMinutes"));
  const content = operation === "save"
    ? saveSalesMeetingOptions(id, task.content, slots, durationMinutes, user.id, savedAt)
    : approveSalesMeetingOptions(id, task.content, user.id, savedAt);
  if (!content) redirect("/sales?notice=meeting-options-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "save" ? "/sales?notice=meeting-options-saved" : "/sales?notice=meeting-options-approved");
}

async function recordMeetingOptionsDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=meeting-options-delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesMeetingOptionsDelivery(
    id, task.content, user.id, new Date().toISOString(),
  );
  if (!content) redirect("/sales?notice=meeting-options-delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=meeting-options-delivery-recorded");
}

async function confirmAppointment(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = confirmSalesAppointment(id, task.content, {
    selectedSlot: formData.get("selectedSlot"),
    meetingUrl: formData.get("meetingUrl"),
    notes: formData.get("notes"),
  }, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=appointment-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=appointment-confirmed");
}

async function reviewAppointmentNotice(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "prepare" && operation !== "approve")
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-notice-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const now = new Date().toISOString();
  const content = operation === "prepare"
    ? prepareSalesAppointmentNotice(id, task.content, user.id, now)
    : approveSalesAppointmentNotice(id, task.content, user.id, now);
  if (!content) redirect("/sales?notice=appointment-notice-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "prepare"
    ? "/sales?notice=appointment-notice-prepared"
    : "/sales?notice=appointment-notice-approved");
}

async function recordAppointmentNoticeDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-notice-delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesAppointmentNoticeDelivery(
    id, task.content, user.id, new Date().toISOString(),
  );
  if (!content) redirect("/sales?notice=appointment-notice-delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=appointment-notice-delivery-recorded");
}

async function reviewAppointmentReminder(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const operation = formData.get("operation");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || (operation !== "prepare" && operation !== "approve")
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-reminder-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const now = new Date().toISOString();
  const content = operation === "prepare"
    ? prepareSalesAppointmentReminder(id, task.content, user.id, now)
    : approveSalesAppointmentReminder(id, task.content, user.id, now);
  if (!content) redirect("/sales?notice=appointment-reminder-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect(operation === "prepare"
    ? "/sales?notice=appointment-reminder-prepared"
    : "/sales?notice=appointment-reminder-approved");
}

async function recordAppointmentReminderDelivery(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-reminder-delivery-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesAppointmentReminderDelivery(
    id, task.content, user.id, new Date().toISOString(),
  );
  if (!content) redirect("/sales?notice=appointment-reminder-delivery-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=appointment-reminder-delivery-recorded");
}

async function recordAppointmentOutcome(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=appointment-outcome-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = recordSalesAppointmentOutcome(id, task.content, {
    result: formData.get("result"),
    notes: formData.get("notes"),
  }, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=appointment-outcome-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=appointment-outcome-recorded");
}

async function schedulePostMeetingFollowUp(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  const dueAt = jstLocalToIso(String(formData.get("dueAt") ?? ""));
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64 || !dueAt
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=post-meeting-follow-up-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = scheduleSalesPostMeetingFollowUp(id, task.content, {
    action: formData.get("action"),
    dueAt,
    owner: formData.get("owner"),
  }, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=post-meeting-follow-up-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=post-meeting-follow-up-scheduled");
}

async function completePostMeetingFollowUp(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64
    || formData.get("confirmed") !== "yes") redirect("/sales?notice=post-meeting-follow-up-invalid");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "PLANNING")
    redirect("/sales?notice=conflict");
  const content = completeSalesPostMeetingFollowUp(id, task.content, user.id, new Date().toISOString());
  if (!content) redirect("/sales?notice=post-meeting-follow-up-invalid");
  const result = await supabase.from("tasks").update({ content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "PLANNING")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=post-meeting-follow-up-completed");
}

function jstLocalToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const utcTime = Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
  const check = new Date(utcTime + 9 * 60 * 60 * 1000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute) return null;
  return new Date(utcTime).toISOString();
}

function toJstLocalInput(value: string | undefined) {
  if (!value) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16) : "";
}

function formatMeetingSlot(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

function defaultReplyDraft(companyName: string, replyType: string, signature: string) {
  if (replyType === "MATERIAL_REQUEST") return {
    subject: "Re: 資料のご希望について",
    body: `${companyName} ご担当者様\n\nご返信ありがとうございます。\nご希望の資料を確認し、別途お送りできるよう準備いたします。\nご不明点がございましたらお知らせください。\n\nどうぞよろしくお願いいたします。`,
    signature,
  };
  return {
    subject: "Re: お問い合わせについて",
    body: `${companyName} ご担当者様\n\nご返信ありがとうございます。\nお問い合わせの内容を確認のうえ、改めてご案内いたします。\n差し支えなければ、特に確認されたい点をお知らせください。\n\nどうぞよろしくお願いいたします。`,
    signature,
  };
}

function defaultFollowUpDraft(companyName: string) {
  return {
    subject: "先日のご案内について",
    body: `${companyName} ご担当者様\n\n先日ご案内した内容につきまして、その後のご状況はいかがでしょうか。\nご不明点や追加で必要な資料がございましたら、お知らせください。\n\nどうぞよろしくお願いいたします。`,
  };
}

async function recordResearch(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || version.length > 64) redirect("/sales?notice=conflict");
  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version || task.status !== "NEW")
    redirect("/sales?notice=conflict");
  const sources = String(formData.get("sources") ?? "").split(/\r?\n/u);
  const content = completeSalesResearch(
    id,
    task.content,
    String(formData.get("notes") ?? ""),
    sources,
    user.id,
    new Date().toISOString(),
  );
  if (!content) redirect("/sales?notice=invalid");
  const result = await supabase.from("tasks")
    .update({ content, status: "PLANNING" })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", "NEW")
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=research-saved");
}

const actionLabels: Record<string, string> = {
  STOP_CONTACT: "配信停止を確認",
  HUMAN_REVIEW: "人間が判断",
  PREPARE_MEETING_OPTIONS: "面談候補を作成",
  CONFIRM_MEETING: "アポ確定を記録",
  PREPARE_APPOINTMENT_NOTICE: "アポ確定案内を確認",
  PREPARE_APPOINTMENT_REMINDER: "アポ前日案内を確認",
  RECORD_APPOINTMENT_OUTCOME: "面談結果を記録",
  SCHEDULE_POST_MEETING_FOLLOW_UP: "面談後フォローを設定",
  COMPLETE_POST_MEETING_FOLLOW_UP: "面談後フォローを完了",
  PREPARE_REPLY: "一次返信案を作成",
  PREPARE_OUTREACH: "初回提案を作成",
  PREPARE_FOLLOW_UP: "追客案を作成",
  RESEARCH_COMPANY: "企業調査を実施",
  NO_ACTION: "外部送信・記録を確認",
};

const roleLabels: Record<string, string> = {
  researcher: "企業リサーチ担当AI",
  sales_writer: "営業文面担当AI",
  scheduler: "日程調整担当AI",
  sales_manager: "営業責任者",
  delivery_operator: "送信管理担当",
};

const replyTypeLabels: Record<string, string> = {
  MATERIAL_REQUEST: "資料希望",
  GENERAL_QUESTION: "一般的な質問",
  SCHEDULING: "日程調整",
  PRICE: "価格・見積",
  DISCOUNT: "値引き相談",
  CONTRACT: "契約・条件",
  COMPLAINT: "クレーム",
  PERSONAL_DATA: "個人情報を含む",
  OPT_OUT: "配信停止",
  UNKNOWN: "分類できない",
};

const appointmentOutcomeLabels: Record<string, string> = {
  FOLLOW_UP: "次回対応",
  WON: "受注",
  LOST: "失注",
  NO_SHOW: "不参加",
};

async function createSalesLead(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const content = createSalesLeadRecord({
    companyName: String(formData.get("companyName") ?? ""),
    website: String(formData.get("website") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    proposalFit: String(formData.get("proposalFit") ?? ""),
  });

  if (!content) redirect("/sales?notice=lead-invalid");

  const lead = parseSalesLeadRecord("preview", content);
  const candidateKey = lead ? companyNameKey(lead.companyName) : null;
  if (!lead || !candidateKey) redirect("/sales?notice=lead-invalid");

  const existing = await supabase.from("tasks")
    .select("id, content")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .limit(501);
  if (existing.error || !existing.data || existing.data.length > 500)
    redirect("/sales?notice=lead-failed");
  const duplicate = existing.data.some((task) => {
    const companyName = parseSalesLeadRecord(String(task.id), task.content)?.companyName;
    return companyNameKey(companyName) === candidateKey;
  });
  if (duplicate) redirect("/sales?notice=lead-duplicate");

  const { error } = await supabase.from("tasks").insert({
    title: `営業見込み：${lead.companyName}`,
    content,
    priority: "高",
    status: "NEW",
  });

  if (error) redirect("/sales?notice=lead-failed");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=lead-created");
}

async function updateLeadProfile(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = String(formData.get("id") ?? "");
  const version = String(formData.get("version") ?? "");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || !version || version.length > 64) redirect("/sales?notice=profile-invalid");

  const { data: task, error } = await supabase.from("tasks")
    .select("id, content, updated_at, status").eq("id", id).single();
  if (error || !task || task.updated_at !== version
    || (task.status !== "NEW" && task.status !== "PLANNING"))
    redirect("/sales?notice=conflict");

  const currentLead = parseSalesLeadRecord(id, task.content);
  const content = updateSalesLeadProfile(id, task.content, {
    companyName: String(formData.get("companyName") ?? ""),
    website: String(formData.get("website") ?? ""),
    contact: String(formData.get("contact") ?? ""),
    proposalFit: String(formData.get("proposalFit") ?? ""),
  });
  const updatedLead = content ? parseSalesLeadRecord(id, content) : null;
  if (!currentLead || !updatedLead) redirect("/sales?notice=profile-invalid");

  if (companyNameKey(currentLead.companyName) !== companyNameKey(updatedLead.companyName)) {
    const existing = await supabase.from("tasks")
      .select("id, content")
      .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
      .limit(501);
    if (existing.error || !existing.data || existing.data.length > 500)
      redirect("/sales?notice=profile-failed");
    const candidateKey = companyNameKey(updatedLead.companyName);
    const duplicate = existing.data.some((other) => other.id !== id
      && companyNameKey(parseSalesLeadRecord(String(other.id), other.content)?.companyName) === candidateKey);
    if (duplicate) redirect("/sales?notice=profile-duplicate");
  }

  const result = await supabase.from("tasks")
    .update({ title: `営業見込み：${updatedLead.companyName}`, content })
    .eq("id", id).eq("updated_at", version).eq("content", task.content).eq("status", task.status)
    .select("id").maybeSingle();
  if (result.error || !result.data) redirect("/sales?notice=conflict");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=profile-saved");
}

async function createSalesLeadsBulk(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.from("tasks")
    .select("id, content")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .limit(501);
  if (error || !data || data.length > 500) redirect("/sales?notice=bulk-invalid");

  const existingCompanyNames = data
    .map((task) => parseSalesLeadRecord(String(task.id), task.content)?.companyName)
    .filter((name): name is string => typeof name === "string");
  const rows = prepareSalesBulkImport(formData.get("bulkLeads"), existingCompanyNames);
  if (!rows) redirect("/sales?notice=bulk-invalid");

  const result = await supabase.from("tasks").insert(rows);
  if (result.error) redirect("/sales?notice=bulk-failed");
  revalidatePath("/sales");
  revalidatePath("/tasks");
  redirect("/sales?notice=bulk-created");
}

export default async function SalesCommandCenterPage({ searchParams }: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("tasks")
    .select("id, content, updated_at")
    .like("content", `${SALES_LEAD_RECORD_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error("営業案件を取得できませんでした。");

  const leads = ((data ?? []) as SalesTask[])
    .map((task) => parseSalesLeadRecord(task.id, task.content))
    .filter((lead) => lead !== null);
  const queue = buildSalesWorkQueue(leads);
  const funnelMetrics = buildSalesFunnelMetrics(leads);
  const leadMap = new Map(leads.map((lead) => [lead.id, lead]));
  const versions = new Map(((data ?? []) as SalesTask[]).map((task) => [task.id, task.updated_at]));
  const replyWaitingLeads = leads.filter((lead) => lead.outreachRecordedAt !== null
    && lead.replies.length < MAX_SALES_REPLIES_WITH_OPT_OUT && !lead.optedOut);
  const confirmedAppointments = leads.filter((lead) => lead.appointmentConfirmed && lead.appointment);
  const auditTimelines = new Map(leads.map((lead) => [lead.id, buildSalesAuditTimeline(lead)]));
  const notices: Record<string, string> = {
    "draft-saved": "提案文を保存しました。保存済みの内容を確認して承認してください。",
    "draft-approved": "文面を承認しました。まだ送信されていません。",
    "delivery-recorded": "外部での送信完了を記録しました。WORK OSからの送信は行っていません。",
    "delivery-invalid": "承認済み文面・送信手段・送信確認を見直してください。二重記録はできません。",
    "reply-recorded": "返信を記録し、次の担当と対応方針を整理しました。返信送信は行っていません。",
    "reply-invalid": "送信済み案件、返信手段、分類、本文を確認してください。返信は1件ずつ処理します。",
    "reply-draft-saved": "一次返信案を保存しました。保存済みの内容を確認して承認してください。",
    "reply-draft-approved": "一次返信案を承認しました。まだ送信されていません。",
    "reply-draft-invalid": "安全対象の返信、件名、本文、署名と確認チェックを見直してください。",
    "reply-delivery-recorded": "外部での一次返信送信を記録しました。WORK OSからの送信は行っていません。",
    "reply-delivery-invalid": "承認済み返信案と送信確認を見直してください。二重記録はできません。",
    "follow-up-saved": "追客メール案を保存しました。内容を確認して承認してください。",
    "follow-up-approved": "追客メール案を承認しました。まだ送信されていません。",
    "follow-up-invalid": "期限到来済みの未返信案件か、件名・本文・承認状態を確認してください。",
    "follow-up-delivery-recorded": "外部での追客メール送信を記録しました。WORK OSからの送信は行っていません。",
    "follow-up-delivery-invalid": "承認済み追客メールと送信確認を見直してください。二重記録はできません。",
    "meeting-options-saved": "面談候補日時を保存しました。保存済み候補を確認して承認してください。",
    "meeting-options-approved": "面談候補日時を承認しました。まだ相手への送信やカレンダー登録は行っていません。",
    "meeting-options-invalid": "日程調整返信と候補日時を確認してください。30分以上先から180日以内の異なる2〜3枠が必要です。",
    "meeting-options-delivery-recorded": "外部での面談候補送信を記録しました。相手の候補選択待ちです。",
    "meeting-options-delivery-invalid": "承認済み候補と送信確認を見直してください。期限間近の候補や二重記録は保存できません。",
    "appointment-confirmed": "アポイントを確定し、確定案内案を保存しました。内容を確認して承認してください。まだ送信されていません。",
    "appointment-invalid": "送信済み候補から日時を選び、有効なHTTPSのWeb面談URLを入力してください。期限直前や二重確定は保存できません。",
    "appointment-notice-prepared": "アポイント確定案内案を保存しました。内容を確認して承認してください。",
    "appointment-notice-approved": "アポイント確定案内を承認しました。まだ送信されていません。",
    "appointment-notice-invalid": "確定日時・案内内容・承認状態を確認してください。開始済みの面談には案内できません。",
    "appointment-notice-delivery-recorded": "外部でのアポイント確定案内送信を記録しました。WORK OSからの送信は行っていません。",
    "appointment-notice-delivery-invalid": "承認済み案内と送信確認を見直してください。開始後や二重記録は保存できません。",
    "appointment-reminder-prepared": "アポイント前日案内を保存しました。内容を確認して承認してください。",
    "appointment-reminder-approved": "アポイント前日案内を承認しました。まだ送信されていません。",
    "appointment-reminder-invalid": "確定案内送信後かつ開始24時間前からの案件か、案内内容・承認状態を確認してください。",
    "appointment-reminder-delivery-recorded": "外部でのアポイント前日案内送信を記録しました。WORK OSからの送信は行っていません。",
    "appointment-reminder-delivery-invalid": "承認済み前日案内と送信確認を見直してください。開始後や二重記録は保存できません。",
    "appointment-outcome-recorded": "面談結果を記録しました。外部送信やカレンダー変更は行っていません。",
    "appointment-outcome-invalid": "面談終了後の未記録案件か、結果・面談メモ・確認チェックを見直してください。二重記録はできません。",
    "post-meeting-follow-up-scheduled": "面談後フォローを設定しました。期限到来時に優先キューへ表示します。",
    "post-meeting-follow-up-completed": "面談後フォローの完了を記録しました。外部送信は行っていません。",
    "post-meeting-follow-up-invalid": "次回対応の面談結果、内容、期限、担当者、確認チェックを見直してください。二重記録はできません。",
    "outreach-invalid": "件名・本文・署名と確認チェックを見直してください。進行済みの案件は変更できません。",
    "research-saved": "調査結果を保存しました。次は初回提案の準備です。",
    "lead-created": "見込み企業を登録しました。次の営業仕事を確認してください。",
    "lead-invalid": "登録を停止しました。企業名、Webサイト、連絡先、提案理由を確認してください。",
    "lead-duplicate": "同じ企業名の見込み企業がすでに登録されています。既存案件を確認してください。",
    "lead-failed": "見込み企業を登録できませんでした。権限や接続を確認し、再度お試しください。",
    "profile-saved": "企業の基本情報を更新しました。調査結果と下書きは保持し、承認済み文面は再承認待ちに戻しました。",
    "profile-invalid": "更新を停止しました。初回送信前の案件か、企業名、Webサイト、連絡先、提案理由に変更があるか確認してください。",
    "profile-duplicate": "更新後の企業名と同じ見込み企業がすでに登録されています。既存案件を確認してください。",
    "profile-failed": "企業情報を更新できませんでした。権限や接続を確認し、再度お試しください。",
    "bulk-created": "見込み企業を一括登録しました。次の営業仕事を確認してください。",
    "bulk-invalid": "一括登録を停止しました。4列の形式、50社上限、入力内容、企業名の重複を確認してください。",
    "bulk-failed": "一括登録を保存できませんでした。権限や接続を確認し、再度お試しください。",
    conflict: "保存できませんでした。他の更新や権限を確認し、再読み込みしてください。",
    invalid: "調査結果を入力してください。この案件はすでに進行している可能性があります。",
  };

  return (
    <main className="min-h-screen bg-[#f7f7f5] px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="os-surface rounded-[24px] p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="os-eyebrow">AI sales department</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">営業司令塔</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                見込み企業を登録すると、WORK OSが担当AIと次の作業を整理します。現在は準備・確認までで、メールやLINEは送信しません。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/sales/proposals" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">企業別提案書</Link>
              <a href="/sales/export" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">営業一覧CSV</a>
              <Link href="/dashboard" className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">Dashboardへ戻る</Link>
            </div>
          </div>
        </header>
        {notice && notices[notice] && <p role="status" className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">{notices[notice]}</p>}

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="見込み企業" value={leads.length} />
          <Summary label="次の作業" value={queue.counts.queued} />
          <Summary label="確定アポ" value={confirmedAppointments.length} />
          <Summary label="要確認データ" value={queue.counts.invalid + queue.counts.duplicate} tone="amber" />
        </section>

        <section className="os-surface mt-6 rounded-[22px] p-6" aria-labelledby="sales-funnel-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="os-eyebrow">Sales funnel</p>
              <h2 id="sales-funnel-heading" className="mt-2 text-xl font-semibold text-zinc-950">営業KPIファネル</h2>
              <p className="mt-2 text-sm text-zinc-500">RLSで閲覧できる最新100社を、保存済みの監査履歴だけで集計します。</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-800">返信率 {formatFunnelRate(funnelMetrics.rates.replyRate)}</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">アポ獲得率 {formatFunnelRate(funnelMetrics.rates.appointmentRate)}</span>
              <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-800">結果記録率 {formatFunnelRate(funnelMetrics.rates.appointmentOutcomeRate)}</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">成約率 {formatFunnelRate(funnelMetrics.rates.winRate)}</span>
            </div>
          </div>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {funnelMetrics.funnel.map((stage, index) => {
              const share = funnelMetrics.counts.registered === 0
                ? 0 : Math.round((stage.count / funnelMetrics.counts.registered) * 100);
              return (
                <li key={stage.key} className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold text-zinc-500">STEP {index + 1}</p>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-900">{stage.label}</p>
                    <p className="text-2xl font-semibold text-zinc-950">{stage.count}</p>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                    <div className="h-full rounded-full bg-zinc-900" style={{ width: `${share}%` }} />
                  </div>
                  <p className="mt-2 text-right text-[11px] text-zinc-500">登録比 {share}%</p>
                </li>
              );
            })}
          </ol>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <FunnelSupport label="追客実施" value={funnelMetrics.counts.followUpLeads} />
            <FunnelSupport label="面談候補送信" value={funnelMetrics.counts.meetingOptionsSent} />
            <FunnelSupport label="配信停止" value={funnelMetrics.counts.optedOut} />
          </dl>
          <section className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4" aria-labelledby="sales-outcome-heading">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 id="sales-outcome-heading" className="font-semibold text-zinc-950">面談後の営業成果</h3>
                <p className="mt-1 text-xs text-zinc-500">受注・失注と、期限超過した次回対応を監査記録から集計します。</p>
              </div>
              <p className="text-xs font-semibold text-zinc-600">結果記録済み {funnelMetrics.counts.appointmentOutcomes}件</p>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FunnelSupport label="結果未記録" value={funnelMetrics.counts.pendingAppointmentOutcomes} />
              <FunnelSupport label="受注" value={funnelMetrics.counts.won} />
              <FunnelSupport label="次回対応" value={funnelMetrics.counts.nextAction} />
              <FunnelSupport label="期限超過フォロー" value={funnelMetrics.counts.overduePostMeetingFollowUps} />
            </dl>
            <p className="mt-3 text-xs text-zinc-500">
              失注 {funnelMetrics.counts.lost}件／不参加 {funnelMetrics.counts.noShow}件／面談後フォロー完了 {funnelMetrics.counts.completedPostMeetingFollowUps}件
            </p>
          </section>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-12">
          <div className="os-surface rounded-[22px] p-6 xl:col-span-5">
            <p className="os-eyebrow">New prospect</p>
            <h2 className="mt-2 text-xl font-semibold text-zinc-950">見込み企業を登録</h2>
            <form action={createSalesLead} className="mt-5 space-y-4">
              <Field label="企業名" name="companyName" required placeholder="例：〇〇工務店" />
              <Field label="Webサイト" name="website" type="url" placeholder="https://example.com" />
              <Field label="連絡先" name="contact" placeholder="メールアドレス、担当部署など" />
              <label className="block text-sm font-semibold text-zinc-800">
                提案できそうな理由
                <textarea name="proposalFit" maxLength={2000} rows={4} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500" placeholder="相手企業に響きそうなポイント" />
              </label>
              <button type="submit" className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800">登録して次の作業を確認</button>
            </form>
            <details className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">Excelから最大50社を一括登録</summary>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                企業名／Webサイト／窓口／提案理由の4列をコピーして貼り付けます。全件を検証し、1件でも不備や重複があれば登録しません。
              </p>
              <form action={createSalesLeadsBulk} className="mt-3 space-y-3">
                <label className="block text-xs font-semibold text-zinc-700">
                  Excelの4列
                  <textarea name="bulkLeads" required maxLength={MAX_SALES_BULK_IMPORT_LENGTH} rows={8} className="mt-1 w-full rounded-xl border border-zinc-300 bg-white p-3 font-mono text-xs outline-none focus:border-zinc-500" placeholder={"企業名\tWebサイト\t窓口\t提案理由\n〇〇工務店\thttps://example.com\t営業部\t保証の提案候補"} />
                </label>
                <p className="text-[11px] leading-4 text-zinc-500">登録済み企業との重複も検査します。外部AI・メール送信は行いません。</p>
                <button className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-100">全件を検証して一括登録</button>
              </form>
            </details>
          </div>

          <div className="os-surface rounded-[22px] p-6 xl:col-span-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="os-eyebrow">Priority queue</p>
                <h2 className="mt-2 text-xl font-semibold text-zinc-950">次にやる営業仕事</h2>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">外部送信OFF</span>
            </div>

            <div className="mt-5 space-y-3">
              {queue.items.map((item, index) => {
                const lead = leadMap.get(item.leadId);
                const latestReply = lead?.replies[lead.replies.length - 1];
                const replyDefaults = lead && latestReply
                  ? defaultReplyDraft(lead.companyName, latestReply.type, lead.outreachDraft?.signature ?? "")
                  : null;
                const followUpDefaults = lead ? defaultFollowUpDraft(lead.companyName) : null;
                return (
                  <article key={item.leadId} className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start gap-4">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-sm font-bold text-white">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-semibold text-zinc-950">{item.companyName}</h3>
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-600">{roleLabels[item.ownerRole] ?? item.ownerRole}</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-zinc-800">{actionLabels[item.action] ?? item.action}</p>
                        {lead?.proposalFit && <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{lead.proposalFit}</p>}
                        {lead?.researchNotes && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">調査結果：{lead.researchNotes}</p>}
                        {lead?.researchAudit && (
                          <ul className="mt-2 space-y-1 text-xs">
                            {lead.researchAudit.sources.map((source: string) => (
                              <li key={source}>
                                <a href={source} target="_blank" rel="noreferrer" className="break-all font-semibold text-blue-700 underline">
                                  調査根拠を開く
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {lead && lead.appointment && (item.action === "PREPARE_APPOINTMENT_NOTICE"
                          || item.reason === "WAIT_FOR_HUMAN_APPOINTMENT_NOTICE_SEND_RECORD") && (
                          <section className="mt-4 space-y-3 rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-950">
                            <p className="font-semibold">アポイント確定案内</p>
                            <p>{formatMeetingSlot(lead.appointment.selectedSlot)}／{lead.appointment.durationMinutes}分</p>
                            {!lead.appointmentNoticeDraft && (
                              <form action={reviewAppointmentNotice} className="space-y-2">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="prepare" />
                                <label className="flex items-start gap-2">
                                  <input type="checkbox" name="confirmed" value="yes" required />
                                  確定日時・Web面談URLから案内案を作成します。
                                </label>
                                <button className="rounded-lg bg-teal-800 px-3 py-2 font-semibold text-white">確定案内案を作成</button>
                              </form>
                            )}
                            {lead.appointmentNoticeDraft && (
                              <div className="space-y-2 rounded-lg border border-teal-200 bg-white p-3">
                                <p className="font-semibold">件名：{lead.appointmentNoticeDraft.subject}</p>
                                <p className="whitespace-pre-wrap text-sm leading-6">{lead.appointmentNoticeDraft.body}</p>
                                {lead.appointmentNoticeDraft.signature && (
                                  <p className="whitespace-pre-wrap border-t border-teal-100 pt-2 text-sm">{lead.appointmentNoticeDraft.signature}</p>
                                )}
                              </div>
                            )}
                            {lead.appointmentNoticeDraft && !lead.appointmentNoticeApproved && (
                              <form action={reviewAppointmentNotice} className="space-y-2">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="approve" />
                                <label className="flex items-start gap-2">
                                  <input type="checkbox" name="confirmed" value="yes" required />
                                  確定日時・参加URL・署名を確認しました。
                                </label>
                                <button className="rounded-lg border border-teal-400 bg-white px-3 py-2 font-semibold text-teal-950">確定案内を承認</button>
                              </form>
                            )}
                            {lead.appointmentNoticeApproved && !lead.appointmentNoticeRecordedAt && (
                              <div className="space-y-3 border-t border-teal-200 pt-3">
                                {lead.meetingOptionsDelivery?.channel === "EMAIL"
                                  && salesEmailRecipient(lead.contact) && (
                                  <a href={`/sales/appointment-notice/${lead.id}`} className="inline-flex rounded-lg bg-blue-800 px-3 py-2 font-semibold text-white">
                                    承認済み未送信の確定案内（.eml）
                                  </a>
                                )}
                                {lead.meetingOptionsDelivery?.channel === "LINE" && (
                                  <p className="rounded-lg bg-white p-2 text-teal-900">上の承認済み本文をLINEへコピーしてください。</p>
                                )}
                                {(lead.meetingOptionsDelivery?.channel === "LINE"
                                  || Boolean(salesEmailRecipient(lead.contact))) ? (
                                  <form action={recordAppointmentNoticeDelivery} className="space-y-2">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <label className="flex items-start gap-2">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      外部で承認済み確定案内を{lead.meetingOptionsDelivery?.channel === "LINE" ? "LINE送信" : "メール送信"}しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-teal-800">送信処理ではなく、送信済み事実だけを記録します。</p>
                                    <button className="rounded-lg bg-teal-950 px-3 py-2 font-semibold text-white">確定案内を送信済みとして記録</button>
                                  </form>
                                ) : (
                                  <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-800">
                                    宛先メールを1件に確定できないため、確定案内を停止しました。営業責任者が連絡先を確認してください。
                                  </p>
                                )}
                              </div>
                            )}
                          </section>
                        )}
                        {lead && lead.appointment && (item.action === "PREPARE_APPOINTMENT_REMINDER"
                          || item.reason === "WAIT_FOR_HUMAN_APPOINTMENT_REMINDER_SEND_RECORD") && (
                          <section className="mt-4 space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                            <p className="font-semibold">アポイント前日案内</p>
                            <p>{formatMeetingSlot(lead.appointment.selectedSlot)}／{lead.appointment.durationMinutes}分</p>
                            {!lead.appointmentReminderDraft && (
                              <form action={reviewAppointmentReminder} className="space-y-2">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="prepare" />
                                <label className="flex items-start gap-2">
                                  <input type="checkbox" name="confirmed" value="yes" required />
                                  面談開始24時間前以内です。確定日時と参加URLから前日案内を作成します。
                                </label>
                                <button className="rounded-lg bg-sky-800 px-3 py-2 font-semibold text-white">前日案内を作成</button>
                              </form>
                            )}
                            {lead.appointmentReminderDraft && (
                              <div className="space-y-2 rounded-lg border border-sky-200 bg-white p-3">
                                <p className="font-semibold">件名：{lead.appointmentReminderDraft.subject}</p>
                                <p className="whitespace-pre-wrap text-sm leading-6">{lead.appointmentReminderDraft.body}</p>
                                {lead.appointmentReminderDraft.signature && (
                                  <p className="whitespace-pre-wrap border-t border-sky-100 pt-2 text-sm">{lead.appointmentReminderDraft.signature}</p>
                                )}
                              </div>
                            )}
                            {lead.appointmentReminderDraft && !lead.appointmentReminderApproved && (
                              <form action={reviewAppointmentReminder} className="space-y-2">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="approve" />
                                <label className="flex items-start gap-2">
                                  <input type="checkbox" name="confirmed" value="yes" required />
                                  面談日時・参加URL・署名を確認しました。
                                </label>
                                <button className="rounded-lg border border-sky-400 bg-white px-3 py-2 font-semibold text-sky-950">前日案内を承認</button>
                              </form>
                            )}
                            {lead.appointmentReminderApproved && !lead.appointmentReminderRecordedAt && (
                              <div className="space-y-3 border-t border-sky-200 pt-3">
                                {lead.meetingOptionsDelivery?.channel === "EMAIL"
                                  && salesEmailRecipient(lead.contact) && (
                                  <a href={`/sales/appointment-reminder/${lead.id}`} className="inline-flex rounded-lg bg-blue-800 px-3 py-2 font-semibold text-white">
                                    承認済み未送信の前日案内（.eml）
                                  </a>
                                )}
                                {lead.meetingOptionsDelivery?.channel === "LINE" && (
                                  <p className="rounded-lg bg-white p-2 text-sky-900">上の承認済み本文をLINEへコピーしてください。</p>
                                )}
                                {(lead.meetingOptionsDelivery?.channel === "LINE"
                                  || Boolean(salesEmailRecipient(lead.contact))) ? (
                                  <form action={recordAppointmentReminderDelivery} className="space-y-2">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <label className="flex items-start gap-2">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      外部で承認済み前日案内を{lead.meetingOptionsDelivery?.channel === "LINE" ? "LINE送信" : "メール送信"}しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-sky-800">送信処理ではなく、送信済み事実だけを記録します。</p>
                                    <button className="rounded-lg bg-sky-950 px-3 py-2 font-semibold text-white">前日案内を送信済みとして記録</button>
                                  </form>
                                ) : (
                                  <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-800">
                                    宛先メールを1件に確定できないため、前日案内を停止しました。営業責任者が連絡先を確認してください。
                                  </p>
                                )}
                              </div>
                            )}
                          </section>
                        )}
                        {lead && item.action === "RECORD_APPOINTMENT_OUTCOME" && lead.appointment && (
                          <form action={recordAppointmentOutcome} className="mt-4 space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
                            <input type="hidden" name="id" value={item.leadId} />
                            <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                            <p className="font-semibold">{formatMeetingSlot(lead.appointment.selectedSlot)}の面談結果</p>
                            <label className="block font-semibold">結果
                              <select name="result" required defaultValue="FOLLOW_UP" className="mt-1 w-full rounded-lg border border-violet-300 bg-white p-2 text-sm">
                                <option value="FOLLOW_UP">次回対応</option>
                                <option value="WON">受注</option>
                                <option value="LOST">失注</option>
                                <option value="NO_SHOW">不参加</option>
                              </select>
                            </label>
                            <label className="block font-semibold">面談メモ
                              <textarea name="notes" required maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border border-violet-300 bg-white p-2 text-sm" />
                            </label>
                            <label className="flex items-start gap-2">
                              <input type="checkbox" name="confirmed" value="yes" required />
                              面談終了後の結果とメモを確認しました。
                            </label>
                            <p className="text-[11px] leading-4 text-violet-800">結果の保存だけを行い、メール・LINE送信やカレンダー変更は行いません。</p>
                            <button className="rounded-lg bg-violet-800 px-3 py-2 font-semibold text-white">面談結果を記録</button>
                          </form>
                        )}
                        {lead && item.action === "SCHEDULE_POST_MEETING_FOLLOW_UP"
                          && lead.appointmentOutcome && (
                          <form action={schedulePostMeetingFollowUp} className="mt-4 space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                            <input type="hidden" name="id" value={item.leadId} />
                            <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                            <p className="font-semibold">面談結果「次回対応」の具体的なフォローを設定</p>
                            <label className="block font-semibold">対応内容
                              <textarea name="action" required maxLength={2000} rows={4} className="mt-1 w-full rounded-lg border border-sky-300 bg-white p-2 text-sm" />
                            </label>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="block font-semibold">期限（日本時間）
                                <input type="datetime-local" name="dueAt" required className="mt-1 w-full rounded-lg border border-sky-300 bg-white p-2 text-sm" />
                              </label>
                              <label className="block font-semibold">担当者
                                <input name="owner" required maxLength={160} placeholder="営業責任者" className="mt-1 w-full rounded-lg border border-sky-300 bg-white p-2 text-sm" />
                              </label>
                            </div>
                            <label className="flex items-start gap-2">
                              <input type="checkbox" name="confirmed" value="yes" required />
                              内容・期限・担当者を確認しました。
                            </label>
                            <p className="text-[11px] leading-4 text-sky-800">管理情報の保存だけを行い、メール・LINE・外部AIは実行しません。</p>
                            <button className="rounded-lg bg-sky-800 px-3 py-2 font-semibold text-white">面談後フォローを設定</button>
                          </form>
                        )}
                        {lead && item.action === "COMPLETE_POST_MEETING_FOLLOW_UP"
                          && lead.postMeetingFollowUp && (
                          <form action={completePostMeetingFollowUp} className="mt-4 space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-950">
                            <input type="hidden" name="id" value={item.leadId} />
                            <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                            <p className="font-semibold">期限：{formatMeetingSlot(lead.postMeetingFollowUp.dueAt)}</p>
                            <p className="whitespace-pre-wrap text-sm">{lead.postMeetingFollowUp.action}</p>
                            <p>担当：{lead.postMeetingFollowUp.owner}</p>
                            <label className="flex items-start gap-2">
                              <input type="checkbox" name="confirmed" value="yes" required />
                              上記の面談後フォローを実際に完了しました。
                            </label>
                            <p className="text-[11px] leading-4 text-rose-800">完了事実の記録だけを行い、外部送信は行いません。</p>
                            <button className="rounded-lg bg-rose-800 px-3 py-2 font-semibold text-white">完了として記録</button>
                          </form>
                        )}
                        {lead && followUpDefaults && (item.action === "PREPARE_FOLLOW_UP"
                          || item.reason === "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD") && (
                          <section className="mt-4 space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs text-orange-950">
                            {!lead.followUpApproved && (
                              <form action={reviewFollowUpDraft} className="space-y-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="save" />
                                <p className="font-semibold">{lead.followUps.length + 1}回目の追客メール案</p>
                                <label className="block font-semibold">件名
                                  <input name="subject" required maxLength={160} defaultValue={lead.followUpDraft?.subject ?? followUpDefaults.subject} className="mt-1 w-full rounded-lg border border-orange-300 bg-white p-2 text-sm" />
                                </label>
                                <label className="block font-semibold">本文
                                  <textarea name="body" required maxLength={4000} rows={7} defaultValue={lead.followUpDraft?.body ?? followUpDefaults.body} className="mt-1 w-full rounded-lg border border-orange-300 bg-white p-2 text-sm" />
                                </label>
                                <p className="text-[11px] leading-4 text-orange-800">署名は承認済み初回文面から継承します。保存しても送信されません。</p>
                                <button className="rounded-lg bg-orange-800 px-3 py-2 font-semibold text-white">追客案を保存</button>
                              </form>
                            )}
                            {lead.followUpDraft && !lead.followUpApproved && (
                              <form action={reviewFollowUpDraft} className="space-y-2 border-t border-orange-200 pt-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="approve" />
                                <p className="font-semibold">保存済み追客案を人間承認</p>
                                <label className="flex items-start gap-2">
                                  <input type="checkbox" name="confirmed" value="yes" required />
                                  件名・本文・継承署名を確認しました。
                                </label>
                                <button className="rounded-lg border border-orange-400 bg-white px-3 py-2 font-semibold text-orange-950">追客案を承認</button>
                              </form>
                            )}
                            {lead.followUpApproved && item.reason === "WAIT_FOR_HUMAN_FOLLOW_UP_SEND_RECORD" && (
                              <div className="space-y-3 border-t border-orange-200 pt-3">
                                {salesEmailRecipient(lead.contact) && (
                                  <a href={`/sales/follow-up-email/${lead.id}`} className="inline-flex rounded-lg bg-blue-800 px-3 py-2 font-semibold text-white">
                                    承認済み未送信の追客メール（.eml）
                                  </a>
                                )}
                                <form action={recordFollowUpDelivery} className="space-y-2">
                                  <input type="hidden" name="id" value={item.leadId} />
                                  <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                  <label className="flex items-start gap-2">
                                    <input type="checkbox" name="confirmed" value="yes" required />
                                    外部メールソフトで、この承認済み追客メールを送信しました。
                                  </label>
                                  <p className="text-[11px] leading-4 text-orange-800">送信処理ではなく、送信済み事実の記録だけを行います。</p>
                                  <button className="rounded-lg bg-orange-950 px-3 py-2 font-semibold text-white">追客メールを送信済みとして記録</button>
                                </form>
                              </div>
                            )}
                          </section>
                        )}
                        {lead && !lead.optedOut && lead.outreachRecordedAt === null
                          && lead.replies.length === 0 && lead.followUps.length === 0 && (
                          <details className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                            <summary className="cursor-pointer text-sm font-semibold">企業の基本情報を編集</summary>
                            <p className="mt-2 text-xs leading-5 text-zinc-500">
                              初回送信前だけ編集できます。調査結果と下書きは保持し、承認済み文面は再承認待ちに戻します。
                            </p>
                            <form action={updateLeadProfile} className="mt-3 grid gap-3 sm:grid-cols-2">
                              <input type="hidden" name="id" value={item.leadId} />
                              <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                              <label className="text-xs font-semibold">企業名
                                <input name="companyName" required maxLength={160} defaultValue={lead.companyName} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm" />
                              </label>
                              <label className="text-xs font-semibold">Webサイト
                                <input type="url" name="website" maxLength={512} defaultValue={lead.website} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm" />
                              </label>
                              <label className="text-xs font-semibold sm:col-span-2">連絡先
                                <input name="contact" maxLength={254} defaultValue={lead.contact} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm" />
                              </label>
                              <label className="text-xs font-semibold sm:col-span-2">提案できそうな理由
                                <textarea name="proposalFit" maxLength={2000} rows={3} defaultValue={lead.proposalFit} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm" />
                              </label>
                              <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white sm:col-span-2">変更を保存</button>
                            </form>
                          </details>
                        )}
                        {latestReply && (
                          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">
                            <p className="text-xs font-semibold text-blue-900">受信返信：{replyTypeLabels[latestReply.type] ?? "要確認"}／{latestReply.channel === "EMAIL" ? "メール" : "LINE"}</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-blue-950">{latestReply.message}</p>
                          </div>
                        )}
                        {lead && latestReply?.type === "SCHEDULING"
                          && (item.action === "PREPARE_MEETING_OPTIONS"
                            || item.action === "CONFIRM_MEETING"
                            || item.reason === "WAIT_FOR_HUMAN_MEETING_OPTIONS_SEND_RECORD") && (
                          <div className="mt-4 space-y-3">
                            {!lead.meetingOptionsRecordedAt && <details className="rounded-xl border border-zinc-200 p-3" open={!lead.meetingOptionsDraft}>
                              <summary className="cursor-pointer text-sm font-semibold">面談候補日時を作成・編集</summary>
                              <p className="mt-2 text-xs text-zinc-500">
                                日本時間で異なる2〜3枠を指定します。保存すると以前の承認は解除されます。
                              </p>
                              <form action={reviewMeetingOptions} className="mt-3 space-y-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="save" />
                                {[0, 1, 2].map((slotIndex) => (
                                  <label key={slotIndex} className="block text-xs font-semibold">
                                    候補{slotIndex + 1}{slotIndex === 2 ? "（任意）" : ""}
                                    <input
                                      type="datetime-local"
                                      name={`option${slotIndex + 1}`}
                                      required={slotIndex < 2}
                                      defaultValue={toJstLocalInput(lead.meetingOptionsDraft?.slots[slotIndex])}
                                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm"
                                    />
                                  </label>
                                ))}
                                <label className="block text-xs font-semibold">面談時間
                                  <select name="durationMinutes" defaultValue={String(lead.meetingOptionsDraft?.durationMinutes ?? 30)} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm">
                                    <option value="30">30分</option>
                                    <option value="45">45分</option>
                                    <option value="60">60分</option>
                                  </select>
                                </label>
                                <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">候補日時を保存・承認待ちへ</button>
                              </form>
                            </details>}
                            {lead.meetingOptionsDraft && (
                              <section className="rounded-xl bg-zinc-50 p-3" aria-label="保存済み面談候補">
                                <p className="text-xs font-semibold">{lead.meetingOptionsRecordedAt
                                  ? "候補送信済み・アポ確定待ち"
                                  : lead.meetingOptionsApproved ? "候補日時承認済み・未送信" : "保存済み・承認待ち"}</p>
                                <ul className="mt-2 list-inside list-decimal space-y-1 text-sm">
                                  {lead.meetingOptionsDraft.slots.map((slot: string) => <li key={slot}>{formatMeetingSlot(slot)}</li>)}
                                </ul>
                                <p className="mt-2 text-xs text-zinc-600">各{lead.meetingOptionsDraft.durationMinutes}分／日本時間</p>
                                {!lead.meetingOptionsApproved && (
                                  <form action={reviewMeetingOptions} className="mt-3 space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <input type="hidden" name="operation" value="approve" />
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の保存済み候補日時を確認しました（未保存の編集内容は対象外）。
                                    </label>
                                    <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">保存済み候補を承認（送信・登録なし）</button>
                                  </form>
                                )}
                                {lead.meetingOptionsApproved && !lead.meetingOptionsRecordedAt && (
                                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                                    <p>承認済みです。WORK OSからの候補送信、カレンダー登録、面談確定は行いません。</p>
                                    <form action={recordMeetingOptionsDelivery} className="mt-3 space-y-3">
                                      <input type="hidden" name="id" value={item.leadId} />
                                      <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                      <label className="flex items-start gap-2">
                                        <input type="checkbox" name="confirmed" value="yes" required />
                                        上の候補日時を外部で{latestReply.channel === "EMAIL" ? "メール" : "LINE"}送信済みです。
                                      </label>
                                      <button className="rounded-lg bg-amber-900 px-3 py-2 font-semibold text-white">外部送信済みとして記録</button>
                                    </form>
                                  </div>
                                )}
                                {lead.meetingOptionsRecordedAt && !lead.appointmentConfirmed && (
                                  <form action={confirmAppointment} className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <label className="block font-semibold">先方が選んだ日時
                                      <select name="selectedSlot" required className="mt-1 w-full rounded-lg border border-emerald-300 bg-white p-2 text-sm">
                                        {lead.meetingOptionsDraft.slots.map((slot: string) => (
                                          <option key={slot} value={slot}>{formatMeetingSlot(slot)}</option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="block font-semibold">Web面談URL
                                      <input type="url" name="meetingUrl" required maxLength={512} placeholder="https://zoom.us/j/..." className="mt-1 w-full rounded-lg border border-emerald-300 bg-white p-2 text-sm" />
                                    </label>
                                    <label className="block font-semibold">面談メモ（任意）
                                      <textarea name="notes" maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border border-emerald-300 bg-white p-2 text-sm" />
                                    </label>
                                    <label className="flex items-start gap-2">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      先方が選んだ候補日時とWeb面談URLを確認しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-emerald-800">カレンダー登録や招待送信は行わず、確定情報の保存だけを行います。</p>
                                    <button className="rounded-lg bg-emerald-800 px-3 py-2 font-semibold text-white">アポイントを確定</button>
                                  </form>
                                )}
                              </section>
                            )}
                          </div>
                        )}
                        {lead && latestReply && replyDefaults
                          && (item.action === "PREPARE_REPLY" || item.reason === "WAIT_FOR_HUMAN_REPLY_SEND_RECORD") && (
                          <div className="mt-4 space-y-3">
                            <details className="rounded-xl border border-zinc-200 p-3" open={!lead.replyDraft}>
                              <summary className="cursor-pointer text-sm font-semibold">一次返信案を作成・編集</summary>
                              <p className="mt-2 text-xs text-zinc-500">
                                安全対象の定型案です。保存すると以前の承認は解除されます。LINEでは件名を使用しません。
                              </p>
                              <form action={reviewReplyDraft} className="mt-3 space-y-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="save" />
                                <label className="block text-xs font-semibold">件名
                                  <input name="subject" required maxLength={160} defaultValue={lead.replyDraft?.subject ?? replyDefaults.subject} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">本文
                                  <textarea name="body" required maxLength={4000} rows={7} defaultValue={lead.replyDraft?.body ?? replyDefaults.body} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">署名（会社名・氏名・連絡先）
                                  <textarea name="signature" maxLength={500} rows={3} defaultValue={lead.replyDraft?.signature ?? replyDefaults.signature} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">返信案を保存・承認待ちへ</button>
                              </form>
                            </details>
                            {lead.replyDraft && (
                              <section className="rounded-xl bg-zinc-50 p-3" aria-label="保存済み一次返信案">
                                <p className="text-xs font-semibold">{lead.replyApproved ? "返信案承認済み・未送信" : "保存済み・承認待ち"}</p>
                                <p className="mt-2 text-sm font-semibold">{lead.replyDraft.subject}</p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{lead.replyDraft.body}</p>
                                <p className="mt-3 whitespace-pre-wrap text-sm">{lead.replyDraft.signature || "署名を入力して保存してください。"}</p>
                                {!lead.replyApproved && (
                                  <form action={reviewReplyDraft} className="mt-3 space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <input type="hidden" name="operation" value="approve" />
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の保存済み返信案と署名を確認しました（未保存の編集内容は対象外）。
                                    </label>
                                    <button disabled={!lead.replyDraft.signature} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">保存済み返信案を承認（送信なし）</button>
                                  </form>
                                )}
                                {lead.replyApproved && item.reason === "WAIT_FOR_HUMAN_REPLY_SEND_RECORD" && (
                                  <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    {latestReply.channel === "EMAIL" && salesEmailRecipient(lead.contact) && (
                                      <div>
                                        <a href={`/sales/reply-email/${lead.id}`} className="inline-flex rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white">
                                          承認済み未送信の一次返信（.eml）
                                        </a>
                                        <p className="mt-2 text-[11px] leading-4 text-amber-800">メールソフトで確認して手動送信してください。出力だけでは送信済みになりません。</p>
                                      </div>
                                    )}
                                    <form action={recordReplyDelivery} className="space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <p className="text-xs font-semibold text-amber-950">
                                      受信元と同じ{latestReply.channel === "EMAIL" ? "メール" : "LINE"}で外部送信した場合だけ記録してください。
                                    </p>
                                    <label className="flex items-start gap-2 text-xs text-amber-950">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の承認済み返信案を、受信元と同じ手段で実際に送信しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-amber-800">この操作は送信処理ではなく、外部で送った事実の記録だけを行います。</p>
                                    <button className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white">一次返信を送信済みとして記録</button>
                                    </form>
                                  </div>
                                )}
                              </section>
                            )}
                          </div>
                        )}
                        {lead?.researchComplete && (item.action === "PREPARE_OUTREACH" || item.reason === "WAIT_FOR_HUMAN_SEND_RECORD") && (
                          <div className="mt-4 space-y-3">
                            <details className="rounded-xl border border-zinc-200 p-3">
                              <summary className="cursor-pointer text-sm font-semibold">提案文を作成・編集</summary>
                              <p className="mt-2 text-xs text-zinc-500">ひな形を編集して保存してください。保存すると承認は解除されます。</p>
                              <form action={reviewOutreach} className="mt-3 space-y-3">
                                <input type="hidden" name="id" value={item.leadId} />
                                <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                <input type="hidden" name="operation" value="save" />
                                <label className="block text-xs font-semibold">件名
                                  <input name="subject" required maxLength={160} defaultValue={lead.outreachDraft?.subject ?? "住宅設備延長保証に関するご相談"} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">本文
                                  <textarea name="body" required maxLength={4000} rows={7} defaultValue={lead.outreachDraft?.body ?? `${lead.companyName} ご担当者様\n\n突然のご連絡失礼いたします。\n住宅設備の延長保証について、貴社のお取り組みを伺いながらご紹介の機会をいただければと存じます。\n\nご関心がございましたら、Web面談のご都合をお知らせいただけますでしょうか。\nどうぞよろしくお願いいたします。`} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <label className="block text-xs font-semibold">署名（会社名・氏名・連絡先）
                                  <textarea name="signature" maxLength={500} rows={3} defaultValue={lead.outreachDraft?.signature ?? ""} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                                </label>
                                <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">文面を保存・承認待ちへ</button>
                              </form>
                            </details>
                            {lead.outreachDraft && (
                              <section className="rounded-xl bg-zinc-50 p-3" aria-label="保存済み提案文">
                                <p className="text-xs font-semibold">{lead.outreachApproved ? "文面承認済み・未送信" : "保存済み・承認待ち"}</p>
                                <p className="mt-2 text-sm font-semibold">{lead.outreachDraft.subject}</p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{lead.outreachDraft.body}</p>
                                <p className="mt-3 whitespace-pre-wrap text-sm">{lead.outreachDraft.signature || "署名を入力して保存してください。"}</p>
                                {!lead.outreachApproved && (
                                  <form action={reviewOutreach} className="mt-3 space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <input type="hidden" name="operation" value="approve" />
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の保存済み文面と署名を確認しました（未保存の編集内容は対象外）。
                                    </label>
                                    <button disabled={!lead.outreachDraft.signature} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">保存済み文面を承認（送信なし）</button>
                                  </form>
                                )}
                                {lead.outreachApproved && item.reason === "WAIT_FOR_HUMAN_SEND_RECORD" && (
                                  <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    {salesEmailRecipient(lead.contact) ? (
                                      <div>
                                        <a href={`/sales/email/${lead.id}`} className="inline-flex rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white">
                                          承認済み未送信メール（.eml）を開く
                                        </a>
                                        <p className="mt-2 text-[11px] leading-4 text-amber-800">メールソフトで内容を確認して手動送信してください。ダウンロードだけでは送信済みになりません。</p>
                                      </div>
                                    ) : (
                                      <p className="text-xs font-semibold text-rose-800">連絡先から宛先メールを1件に確定できないため、未送信メールを出力できません。</p>
                                    )}
                                    <form action={recordOutreachDelivery} className="space-y-3">
                                    <input type="hidden" name="id" value={item.leadId} />
                                    <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                                    <label className="block text-xs font-semibold">外部で送信した手段
                                      <select name="channel" required defaultValue="EMAIL" className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-sm">
                                        <option value="EMAIL">メール</option>
                                        <option value="LINE">LINE</option>
                                      </select>
                                    </label>
                                    <label className="flex items-start gap-2 text-xs">
                                      <input type="checkbox" name="confirmed" value="yes" required />
                                      上の承認済み文面を、選択した手段で実際に送信しました。
                                    </label>
                                    <p className="text-[11px] leading-4 text-amber-800">この操作は送信処理ではなく、外部で送った事実の記録だけを行います。</p>
                                    <button className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white">送信済みとして記録</button>
                                    </form>
                                  </div>
                                )}
                              </section>
                            )}
                          </div>
                        )}
                        {item.action === "RESEARCH_COMPANY" && (
                          <form action={recordResearch} className="mt-3 space-y-2">
                            <input type="hidden" name="id" value={item.leadId} />
                            <input type="hidden" name="version" value={versions.get(item.leadId) ?? ""} />
                            <label className="block text-xs font-semibold text-zinc-700">
                              調査結果（確認した情報）
                              <textarea name="notes" required maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                            </label>
                            <label className="block text-xs font-semibold text-zinc-700">
                              根拠URL（HTTPS、1行1件・最大5件）
                              <textarea name="sources" required maxLength={2564} rows={3} placeholder="https://example.com/company" className="mt-1 w-full rounded-lg border border-zinc-300 p-2 font-mono text-xs" />
                            </label>
                            <p className="text-[11px] leading-4 text-zinc-500">完了者とサーバー時刻も監査情報として保存します。外部サイトへの自動アクセスは行いません。</p>
                            <button className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">調査完了・提案準備へ</button>
                          </form>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {queue.items.length === 0 && (
                <div className="rounded-2xl bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">見込み企業を登録すると、次の作業がここに並びます。</div>
              )}
            </div>
          </div>
        </section>

        <section className="os-surface mt-6 rounded-[22px] p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="os-eyebrow">Sales audit</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-950">企業別の営業監査履歴</h2>
              <p className="mt-2 text-sm text-zinc-500">承認・外部送信記録・返信・日程調整・アポイント確定を時系列で最大40件表示します。</p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">読み取り専用</span>
          </div>
          <div className="mt-5 space-y-3">
            {leads.map((lead) => {
              const events = auditTimelines.get(lead.id) ?? [];
              return (
                <details key={lead.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <summary className="cursor-pointer list-none font-semibold text-zinc-950">
                    <span>{lead.companyName}</span>
                    <span className="ml-2 text-xs font-medium text-zinc-500">{events.length}件</span>
                  </summary>
                  {events.length > 0 ? (
                    <ol className="mt-4 space-y-3 border-l border-zinc-200 pl-4">
                      {events.map((event, index) => (
                        <li key={`${event.occurredAt}-${event.type}-${index}`} className="text-sm text-zinc-700">
                          <p className="font-semibold text-zinc-900">{event.label}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {formatMeetingSlot(event.occurredAt)}／実行者 {event.actorId}
                            {event.channel ? `／${event.channel === "EMAIL" ? "メール" : "LINE"}` : ""}
                          </p>
                          {event.detail && <p className="mt-1 text-xs text-zinc-600">対象日時：{formatMeetingSlot(event.detail)}</p>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-sm text-zinc-500">監査対象の操作はまだありません。</p>
                  )}
                </details>
              );
            })}
            {leads.length === 0 && (
              <p className="rounded-2xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">表示できる営業案件はありません。</p>
            )}
          </div>
        </section>

        <section className="os-surface mt-6 rounded-[22px] p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="os-eyebrow">Inbound replies</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-950">送信済み・返信受付</h2>
              <p className="mt-2 text-sm text-zinc-500">外部で受信した返信を記録します。価格・契約・クレーム等は必ず人間確認で停止します。</p>
            </div>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">記録対象 {replyWaitingLeads.length}件</span>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {replyWaitingLeads.map((lead) => {
              const optOutOnly = requiresOptOutOnlyReplyIntake(lead);
              const defaultChannel = salesReplyIntakeDefaultChannel(lead);
              return (
                <form key={lead.id} action={recordInboundReply} className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <input type="hidden" name="id" value={lead.id} />
                  <input type="hidden" name="version" value={versions.get(lead.id) ?? ""} />
                  <h3 className="font-semibold text-zinc-950">{lead.companyName}</h3>
                  {lead.replies.length > 0 && (
                    <p className="mt-2 text-xs leading-5 text-amber-800">
                      {optOutOnly
                        ? "直前の返信対応が完了していないか、返信履歴が上限のため、追加できるのは配信停止だけです。"
                        : "継続返信は直前の対応完了後に記録できます。対応途中でも配信停止は記録できます。"}
                    </p>
                  )}
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold">受信手段
                      <select name="channel" required defaultValue={defaultChannel} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm">
                        <option value="EMAIL">メール</option>
                        <option value="LINE">LINE</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold">返信の種類
                      <select name="type" required defaultValue={optOutOnly ? "OPT_OUT" : "UNKNOWN"} className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm">
                        {Object.entries(replyTypeLabels)
                          .filter(([value]) => !optOutOnly || value === "OPT_OUT")
                          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="mt-3 block text-xs font-semibold">受信した本文
                    <textarea name="message" required maxLength={4000} rows={5} className="mt-1 w-full rounded-lg border border-zinc-300 p-2 text-sm" />
                  </label>
                  <button className="mt-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white">返信を記録・次の対応を判定</button>
                </form>
              );
            })}
            {replyWaitingLeads.length === 0 && (
              <p className="rounded-2xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 lg:col-span-2">返信を記録できる送信済み案件はありません。</p>
            )}
          </div>
        </section>

        <section className="os-surface mt-6 rounded-[22px] p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="os-eyebrow">Confirmed appointments</p>
              <h2 className="mt-2 text-xl font-semibold text-zinc-950">確定アポイント</h2>
              <p className="mt-2 text-sm text-zinc-500">確定日時とWeb面談URLを確認します。カレンダー登録・招待送信は行いません。</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{confirmedAppointments.length}件</span>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {confirmedAppointments.map((lead) => lead.appointment && (
              <article key={lead.id} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="font-semibold text-zinc-950">{lead.companyName}</h3>
                <p className="mt-2 text-sm font-semibold text-emerald-950">{formatMeetingSlot(lead.appointment.selectedSlot)}</p>
                <p className="mt-1 text-xs text-emerald-800">{lead.appointment.durationMinutes}分／日本時間</p>
                <a href={lead.appointment.meetingUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-sm font-semibold text-blue-700 underline">
                  Web面談URLを開く
                </a>
                <a href={`/sales/calendar/${lead.id}`} className="ml-3 mt-3 inline-block text-sm font-semibold text-emerald-800 underline">
                  カレンダー予定（.ics）
                </a>
                <p className={`mt-3 text-xs font-semibold ${lead.appointmentNoticeRecordedAt ? "text-emerald-800" : "text-amber-800"}`}>
                  確定案内：{lead.appointmentNoticeRecordedAt ? "外部送信済み" : lead.appointmentNoticeApproved ? "承認済み・未送信" : "承認待ち"}
                </p>
                <p className={`mt-1 text-xs font-semibold ${lead.appointmentReminderRecordedAt ? "text-emerald-800" : "text-zinc-600"}`}>
                  前日案内：{lead.appointmentReminderRecordedAt ? "外部送信済み" : lead.appointmentReminderApproved ? "承認済み・未送信" : lead.appointmentReminderDraft ? "承認待ち" : "開始24時間前に準備"}
                </p>
                {lead.appointment.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">{lead.appointment.notes}</p>}
                {lead.appointmentOutcome ? (
                  <div className="mt-3 rounded-lg bg-white/70 p-3 text-sm">
                    <p className="font-semibold text-emerald-950">結果：{appointmentOutcomeLabels[lead.appointmentOutcome.result] ?? lead.appointmentOutcome.result}</p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-700">{lead.appointmentOutcome.notes}</p>
                  </div>
                ) : <p className="mt-3 text-xs font-semibold text-amber-800">結果未記録</p>}
                {lead.postMeetingFollowUp && (
                  <div className="mt-3 rounded-lg border border-sky-200 bg-white/80 p-3 text-sm">
                    <p className="font-semibold text-sky-950">
                      面談後フォロー：{lead.postMeetingFollowUp.completedAt ? "完了" : "未完了"}
                    </p>
                    <p className="mt-1 text-xs text-sky-800">
                      期限 {formatMeetingSlot(lead.postMeetingFollowUp.dueAt)}／担当 {lead.postMeetingFollowUp.owner}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-zinc-700">{lead.postMeetingFollowUp.action}</p>
                  </div>
                )}
              </article>
            ))}
            {confirmedAppointments.length === 0 && (
              <p className="rounded-2xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 lg:col-span-2">確定済みのアポイントはありません。</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Summary({ label, value, tone = "zinc" }: { label: string; value: number; tone?: "zinc" | "amber" }) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"}`}>
      <p className="text-sm font-medium text-zinc-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function FunnelSupport({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-4 py-3">
      <dt className="text-sm font-medium text-zinc-600">{label}</dt>
      <dd className="text-lg font-semibold text-zinc-950">{value}</dd>
    </div>
  );
}

function formatFunnelRate(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

function Field({ label, name, type = "text", required = false, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder: string }) {
  return (
    <label className="block text-sm font-semibold text-zinc-800">
      {label}
      <input name={name} type={type} required={required} maxLength={type === "url" ? 512 : 254} className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500" placeholder={placeholder} />
    </label>
  );
}
