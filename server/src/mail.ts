import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST ?? "";
const PORT = Number(process.env.SMTP_PORT) || 465;
const USER = process.env.SMTP_USER ?? "";
const PASS = process.env.SMTP_PASS ?? "";
const FROM = process.env.SMTP_FROM || (USER ? `Tempo Chess <${USER}>` : "");
const SITE = (process.env.SITE_URL ?? "https://tempo-chess.onrender.com").replace(/\/+$/, "");
const INSECURE = process.env.SMTP_INSECURE === "1";

export const MAIL_ON = !!(HOST && USER && PASS);

const transport = MAIL_ON
  ? nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465 && !INSECURE,
      ignoreTLS: INSECURE,
      auth: { user: USER, pass: PASS },
      pool: true,
      maxConnections: 1,
      rateDelta: 1000,
      rateLimit: 1,
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    })
  : null;

export function mailStatus() {
  return { configured: MAIL_ON, from: MAIL_ON ? FROM : null };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function cleanSubject(s: string) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

export function render(subject: string, message: string, name: string | null) {
  const hello = name ? `Hi ${name},` : "Hi,";
  const text = `${hello}\n\n${message}\n\n— The Tempo team\n${SITE}\n\nYou receive this because you have a Tempo account.`;
  const paragraphs = escapeHtml(message)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<div style="background:#121210;padding:32px 16px;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#191916;border:1px solid #2C2B26;border-radius:16px;padding:30px;color:#EDEAE1">
<p style="margin:0 0 14px;font-family:Georgia,serif;font-size:24px;color:#B8914F">Tempo</p>
<h1 style="font-size:19px;margin:0 0 16px">${escapeHtml(subject)}</h1>
<p style="margin:0 0 14px">${escapeHtml(hello)}</p>
${paragraphs}
<p style="margin:18px 0 0;color:#8E8A7E">— The Tempo team</p>
<a href="${SITE}" style="display:inline-block;margin-top:18px;padding:10px 20px;background:#B8914F;color:#17140f;border-radius:10px;font-weight:bold;text-decoration:none">Open Tempo</a>
<p style="margin:22px 0 0;color:#8E8A7E;font-size:12px">You receive this because you have a Tempo account.</p>
</div></div>`;
  return { text, html };
}

export type Recipient = { email: string; name: string | null };

type Job = { id: string; total: number; sent: number; failed: number; done: boolean; started: number };
const jobs = new Map<string, Job>();

export function startJob(id: string, subject: string, message: string, to: Recipient[]) {
  const job: Job = { id, total: to.length, sent: 0, failed: 0, done: false, started: Date.now() };
  jobs.set(id, job);
  if (jobs.size > 100) jobs.delete(jobs.keys().next().value!);
  void (async () => {
    for (const r of to) {
      const { text, html } = render(subject, message, r.name);
      try {
        await transport!.sendMail({ from: FROM, to: r.email, subject, text, html });
        job.sent++;
      } catch (err) {
        job.failed++;
        console.warn("Email not sent:", (err as Error).message);
      }
    }
    job.done = true;
  })();
  return job;
}

export function jobStatus(id: string) {
  return jobs.get(id) ?? null;
}
