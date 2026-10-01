Warning: truncated output (original token count: 30915)
Total output lines: 1814

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { buildSalesWorkQueue } from "@/lib/sales-work-queue.js";
import { buildSalesAuditTimeline } from "@/lib/sales-audit-timeline.js";
import { buildSalesFunnelMetrics } from "@/lib/sales-funnel-metrics.js";
import { buildSalesIntegrationReadiness } from "@/lib/sales-integration-readiness.js";
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
  }, user.id, new Date().…18915 tokens truncated…>保存済み返信案を承認（送信なし）</button>
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
