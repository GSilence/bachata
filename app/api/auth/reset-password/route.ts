import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimiter";

export const dynamic = "force-dynamic";

function isStrongPassword(v: string) {
  return v.length >= 8 && /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v);
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(`reset:${ip}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Слишком много попыток" }, { status: 429 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const { token = "", password = "", confirmPassword = "" } = await request
    .json()
    .catch(() => ({}));

  if (!token) {
    return NextResponse.json({ error: "Токен не указан" }, { status: 400 });
  }
  if (!isStrongPassword(password)) {
    return NextResponse.json(
      { error: "Минимум 8 символов, хотя бы одна цифра или спецсимвол" },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Пароли не совпадают" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { passwordResetToken: token },
    select: { id: true, passwordResetExpiresAt: true },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Ссылка недействительна или уже использована" },
      { status: 400 },
    );
  }

  if (user.passwordResetExpiresAt && user.passwordResetExpiresAt < new Date()) {
    return NextResponse.json(
      { error: "Ссылка истекла. Запросите новый сброс пароля." },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    },
  });

  return NextResponse.json({ success: true, message: "Пароль изменён. Войдите с новым паролем." });
}
