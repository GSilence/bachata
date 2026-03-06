/**
 * Email utility через Resend API (HTTPS, порт 443).
 *
 * Переменные окружения (.env):
 *   RESEND_API_KEY — API-ключ Resend (re_...)
 *   SMTP_FROM      — отображаемый адрес отправителя (напр. "Bachata <noreply@bachata-music.com>")
 *   APP_URL        — базовый URL сайта (напр. https://bachata-music.com) — для ссылок в письмах
 *
 * Если RESEND_API_KEY не задан — письма выводятся в консоль (dev-режим).
 */

import { Resend } from "resend";

export const APP_URL =
  process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const resend = getResend();
  const from =
    process.env.SMTP_FROM || "Bachata <noreply@bachata-music.com>";

  if (!resend) {
    // Dev-режим: письмо в консоль
    console.log("\n[EMAIL DEV MODE]");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Text: ${options.text || "(html only)"}`);
    console.log("---");
    return;
  }

  const { error } = await resend.emails.send({
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

// ─── Шаблоны писем ──────────────────────────────────────────────────────────

function baseTemplate(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #111; color: #e5e7eb; margin: 0; padding: 0; }
    .wrap { max-width: 520px; margin: 40px auto; padding: 0 16px; }
    .card { background: #1f2937; border: 1px solid #374151; border-radius: 12px;
            padding: 32px; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
    .logo-icon { width: 40px; height: 40px; background: linear-gradient(135deg, #7c3aed, #5b21b6);
                 border-radius: 10px; display: flex; align-items: center; justify-content: center;
                 font-weight: bold; font-size: 20px; color: white; }
    .logo-name { font-size: 20px; font-weight: 600; color: white; }
    h2 { color: white; margin: 0 0 16px; font-size: 22px; }
    p { color: #9ca3af; line-height: 1.6; margin: 0 0 16px; }
    .btn { display: inline-block; padding: 14px 28px;
           background: linear-gradient(135deg, #7c3aed, #5b21b6);
           color: white !important; text-decoration: none; border-radius: 8px;
           font-weight: 600; font-size: 16px; margin: 8px 0 24px; }
    .link { color: #9ca3af; font-size: 13px; word-break: break-all; }
    .footer { margin-top: 24px; color: #6b7280; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="logo">
      <div class="logo-icon">B</div>
      <div class="logo-name">Bachata</div>
    </div>
    ${bodyHtml}
  </div>
  <div class="footer">© Bachata Beat Counter</div>
</div>
</body>
</html>`;
}

export function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = `${APP_URL}/verify-email?token=${token}`;
  return sendEmail({
    to,
    subject: "Подтвердите email — Bachata",
    text: `Подтвердите адрес электронной почты: ${url}`,
    html: baseTemplate(
      "Подтверждение email",
      `<h2>Подтвердите email</h2>
       <p>Нажмите кнопку ниже, чтобы активировать аккаунт. Ссылка действует 24 часа.</p>
       <a class="btn" href="${url}">Подтвердить email</a>
       <p class="link">Или скопируйте ссылку вручную:<br>${url}</p>`,
    ),
  });
}

export function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const url = `${APP_URL}/reset-password?token=${token}`;
  return sendEmail({
    to,
    subject: "Сброс пароля — Bachata",
    text: `Ссылка для сброса пароля: ${url}`,
    html: baseTemplate(
      "Сброс пароля",
      `<h2>Сброс пароля</h2>
       <p>Мы получили запрос на сброс пароля для вашего аккаунта. Ссылка действует 1 час.</p>
       <a class="btn" href="${url}">Задать новый пароль</a>
       <p class="link">Или скопируйте ссылку вручную:<br>${url}</p>
       <p>Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо.</p>`,
    ),
  });
}
