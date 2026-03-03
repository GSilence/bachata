import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, getRetryAfter } from "@/lib/rateLimiter";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  // 3 запроса сброса с одного IP за 15 минут
  if (!checkRateLimit(`forgot:${ip}`, 3, 15 * 60 * 1000)) {
    return NextResponse.json(
      { error: `Слишком много запросов. Подождите ${getRetryAfter(`forgot:${ip}`)} сек.` },
      { status: 429 },
    );
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const { email = "" } = await request.json().catch(() => ({}));

  if (!email.trim()) {
    return NextResponse.json({ error: "Укажите email" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true, email: true, isBanned: true },
  });

  // Всегда возвращаем успех, чтобы не раскрывать наличие email в базе
  if (!user || user.isBanned) {
    return NextResponse.json({
      success: true,
      message: "Если email зарегистрирован, вам придёт письмо.",
    });
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: token, passwordResetExpiresAt: expiresAt },
  });

  try {
    await sendPasswordResetEmail(user.email, token);
  } catch (err) {
    console.error("[forgot-password] Email send failed:", err);
  }

  return NextResponse.json({
    success: true,
    message: "Если email зарегистрирован, вам придёт письмо.",
  });
}
