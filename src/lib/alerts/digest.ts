/**
 * Daily anomaly digest.
 *
 * Delivery channels:
 *   1. Email via SMTP (nodemailer) — set ALERT_SMTP_* env vars
 *   2. WhatsApp via Twilio API — set TWILIO_* + ALERT_WA_TO env vars
 *
 * Either channel is skipped gracefully if its env vars are absent.
 */
import { fetchAnomalies } from "@/lib/shop/anomaly";

export interface AlertConfig {
  /** Comma-separated list of email recipients */
  emailTo: string;
  /** Comma-separated WhatsApp numbers, e.g. +919876543210,+919123456789 */
  whatsappTo: string;
}

export interface DigestResult {
  anomalyCount: number;
  emailSent: boolean;
  whatsappSent: boolean;
  errors: string[];
}

// ─── Build the text ───────────────────────────────────────────────────────────

function buildDigest(rows: Awaited<ReturnType<typeof fetchAnomalies>>): {
  subject: string;
  text: string;
  html: string;
} {
  const today = new Date().toLocaleDateString("en-IN", { dateStyle: "long" });
  const overdue  = rows.filter((r) => r.kind === "overdue");
  const noMove   = rows.filter((r) => r.kind === "no_movement" && r.daysSince >= 7);
  const scrap    = rows.filter((r) => r.kind === "scrap_spike");
  const balance  = rows.filter((r) => r.kind === "balance_error");
  const longRun  = rows.filter((r) => r.kind === "long_running");

  const subject = `[Shop Alert] ${rows.length} anomal${rows.length === 1 ? "y" : "ies"} — ${today}`;

  const section = (title: string, items: typeof rows) =>
    items.length === 0
      ? ""
      : `\n${title} (${items.length})\n` +
        items.map((r) => `  • ${r.routerNo}  ${r.partNumber} ${r.partName}  — ${r.detail}`).join("\n");

  const text = [
    `Shop Floor Anomaly Digest — ${today}`,
    `Total: ${rows.length} anomalies`,
    section("OVERDUE", overdue),
    section("NO MOVEMENT (≥7 days)", noMove),
    section("SCRAP SPIKE", scrap),
    section("BALANCE ERROR", balance),
    section("LONG-RUNNING MOVE", longRun),
    `\nView full dashboard: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://aicadcamnew.vercel.app"}/shop/anomalies`,
  ].join("\n");

  const row = (r: (typeof rows)[0]) =>
    `<tr>
       <td style="padding:4px 8px;border-bottom:1px solid #eee;font-family:monospace">${r.routerNo}</td>
       <td style="padding:4px 8px;border-bottom:1px solid #eee">${r.partNumber} ${r.partName}</td>
       <td style="padding:4px 8px;border-bottom:1px solid #eee">${r.kind.replace(/_/g, " ")}</td>
       <td style="padding:4px 8px;border-bottom:1px solid #eee">${r.detail}</td>
     </tr>`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
      <h2 style="color:#111">Shop Floor Anomaly Digest</h2>
      <p style="color:#555">${today} &nbsp;·&nbsp; <strong>${rows.length}</strong> anomal${rows.length === 1 ? "y" : "ies"} detected</p>
      ${rows.length === 0
        ? `<p style="color:#22c55e;font-weight:bold">✓ No anomalies today. Shop is running clean.</p>`
        : `<table style="width:100%;border-collapse:collapse;font-size:13px">
             <thead>
               <tr style="background:#111;color:#fff">
                 <th style="padding:6px 8px;text-align:left">Router</th>
                 <th style="padding:6px 8px;text-align:left">Part</th>
                 <th style="padding:6px 8px;text-align:left">Type</th>
                 <th style="padding:6px 8px;text-align:left">Detail</th>
               </tr>
             </thead>
             <tbody>${rows.map(row).join("")}</tbody>
           </table>`
      }
      <p style="margin-top:16px">
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://aicadcamnew.vercel.app"}/shop/anomalies"
           style="background:#111;color:#fff;padding:8px 16px;text-decoration:none;border-radius:6px;font-size:13px">
          View Full Dashboard →
        </a>
      </p>
      <p style="font-size:11px;color:#aaa;margin-top:24px">
        Manufacturing AI Intelligence · Nexcraft Tech ·
        Unsubscribe: set ALERT_EMAIL_TO= in environment variables.
      </p>
    </div>`;

  return { subject, text, html };
}

// ─── Email via nodemailer ─────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const host = process.env.ALERT_SMTP_HOST;
  const user = process.env.ALERT_SMTP_USER;
  const pass = process.env.ALERT_SMTP_PASS;
  const from = process.env.ALERT_SMTP_FROM ?? user;
  const port = parseInt(process.env.ALERT_SMTP_PORT ?? "587");

  if (!host || !user || !pass) throw new Error("ALERT_SMTP_HOST / ALERT_SMTP_USER / ALERT_SMTP_PASS not set");

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({ from, to, subject, text, html });
}

// ─── WhatsApp via Twilio ──────────────────────────────────────────────────────

async function sendWhatsApp(to: string, body: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_WA_FROM; // e.g. whatsapp:+14155238886

  if (!sid || !token || !from) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WA_FROM not set");

  const numbers = to.split(",").map((n) => n.trim()).filter(Boolean);
  for (const number of numbers) {
    const toWa = number.startsWith("whatsapp:") ? number : `whatsapp:${number}`;
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        },
        body: new URLSearchParams({ From: from, To: toWa, Body: body }),
      },
    );
    if (!res.ok) {
      const err = (await res.json()) as { message?: string };
      throw new Error(`Twilio error for ${number}: ${err.message ?? res.status}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runDigest(config: Partial<AlertConfig> = {}): Promise<DigestResult> {
  const emailTo     = config.emailTo    ?? process.env.ALERT_EMAIL_TO    ?? "";
  const whatsappTo  = config.whatsappTo ?? process.env.ALERT_WA_TO       ?? "";

  // Fetch anomalies — only high-priority (overdue, no_movement ≥ 7 d, scrap, balance error)
  const rows = await fetchAnomalies({ minDays: 0 });

  const { subject, text, html } = buildDigest(rows);
  const errors: string[] = [];
  let emailSent = false;
  let whatsappSent = false;

  if (emailTo) {
    try {
      await sendEmail(emailTo, subject, text, html);
      emailSent = true;
    } catch (e) {
      errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (whatsappTo) {
    // Plain text for WhatsApp — keep under ~1000 chars
    const short = [
      `*Shop Floor Digest* — ${new Date().toLocaleDateString("en-IN")}`,
      `${rows.length} anomal${rows.length === 1 ? "y" : "ies"} detected.`,
      rows.slice(0, 10).map((r) => `• ${r.routerNo} ${r.partName} — ${r.detail}`).join("\n"),
      rows.length > 10 ? `...and ${rows.length - 10} more.` : "",
      `View: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://aicadcamnew.vercel.app"}/shop/anomalies`,
    ].filter(Boolean).join("\n");

    try {
      await sendWhatsApp(whatsappTo, short);
      whatsappSent = true;
    } catch (e) {
      errors.push(`WhatsApp: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { anomalyCount: rows.length, emailSent, whatsappSent, errors };
}
