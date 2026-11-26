"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle, XCircle, Send } from "lucide-react";

export default function AlertSettingsPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{
    anomalyCount: number;
    emailSent: boolean;
    whatsappSent: boolean;
    errors: string[];
  } | null>(null);

  const trigger = async () => {
    setLoading(true);
    setResult(null);
    try {
      const secret = (document.getElementById("secret") as HTMLInputElement).value;
      const res = await fetch("/api/alerts/digest", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      setResult(await res.json() as typeof result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"             className="text-xs text-gray-400 hover:text-gray-900">Home</Link>
          <span className="text-gray-200">/</span>
          <Link href="/admin/system" className="text-xs text-gray-400 hover:text-gray-900">Admin</Link>
          <span className="text-gray-200">/</span>
          <h1 className="text-sm font-bold">Anomaly Alerts</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <div className="rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-gray-700" />
            <h2 className="font-semibold text-gray-900">Daily Anomaly Digest</h2>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            Runs automatically at <strong>07:00 AM IST</strong> every day via Vercel Cron
            (<code className="bg-gray-100 px-1 rounded text-xs">0 1:30 * * *</code> UTC).
            Use the button below to send a test digest right now.
          </p>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-3 text-sm">
            <p className="font-medium text-gray-700">Environment variables needed</p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-100">
                {[
                  ["CRON_SECRET",         "Any random string — protects the digest endpoint"],
                  ["ALERT_EMAIL_TO",       "Comma-separated email addresses"],
                  ["ALERT_SMTP_HOST",      "SMTP host (e.g. smtp.gmail.com)"],
                  ["ALERT_SMTP_PORT",      "587 for TLS, 465 for SSL"],
                  ["ALERT_SMTP_USER",      "SMTP login username"],
                  ["ALERT_SMTP_PASS",      "SMTP login password / app password"],
                  ["ALERT_SMTP_FROM",      "From address (defaults to ALERT_SMTP_USER)"],
                  ["ALERT_WA_TO",          "Comma-separated WhatsApp numbers e.g. +919876543210"],
                  ["TWILIO_ACCOUNT_SID",   "Twilio account SID (WhatsApp only)"],
                  ["TWILIO_AUTH_TOKEN",    "Twilio auth token"],
                  ["TWILIO_WA_FROM",       "Twilio sender e.g. whatsapp:+14155238886"],
                  ["NEXT_PUBLIC_APP_URL",  "Your deployed URL for dashboard links in messages"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 pr-4 font-mono font-semibold text-gray-800">{k}</td>
                    <td className="py-1.5 text-gray-500">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-end gap-3 pt-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">CRON_SECRET to authenticate</label>
              <input
                id="secret"
                type="password"
                placeholder="Paste your CRON_SECRET here to test"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-700 outline-none"
              />
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void trigger()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:opacity-50 shrink-0"
            >
              <Send className="h-4 w-4" />
              {loading ? "Sending…" : "Send test digest"}
            </button>
          </div>
        </div>

        {result && (
          <div className="rounded-xl border border-gray-200 p-5 space-y-3">
            <p className="font-semibold text-gray-900">Result</p>
            <p className="text-sm text-gray-600">Anomalies found: <strong>{result.anomalyCount}</strong></p>
            <div className="flex gap-4 text-sm">
              <span className={`flex items-center gap-1.5 ${result.emailSent ? "text-green-700" : "text-gray-400"}`}>
                {result.emailSent ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                Email {result.emailSent ? "sent" : "not sent"}
              </span>
              <span className={`flex items-center gap-1.5 ${result.whatsappSent ? "text-green-700" : "text-gray-400"}`}>
                {result.whatsappSent ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                WhatsApp {result.whatsappSent ? "sent" : "not sent"}
              </span>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-gray-700 font-mono">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
