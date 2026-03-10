import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";
import { checkRateLimit, getRetryAfter } from "@/lib/rateLimiter";
import { ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

// ─── Валидаторы ──────────────────────────────────────────────────────────────

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function isValidName(v: string) {
  // только буквы (любые), пробелы, дефисы, точки; 2–200 символов
  return /^[\p{L}\s\-.]{2,200}$/u.test(v.trim());
}

function isValidTelegram(v: string) {
  // @username или username: 5–32 символа, только a-z/0-9/_
  const clean = v.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9_]{5,32}$/.test(clean);
}

function isValidPhone(v: string) {
  // международный формат +XXXXXXXXXXX (8–15 цифр)
  return /^\+[1-9]\d{7,14}$/.test(v.trim().replace(/[\s\-()]/g, ""));
}

function isStrongPassword(v: string) {
  // минимум 8 символов, хотя бы одна цифра или спецсимвол
  return v.length >= 8 && /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v);
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limiting: 5 регистраций с одного IP за 10 минут
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(`register:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: `Слишком много попыток. Подождите ${getRetryAfter(`register:${ip}`)} сек.` },
      { status: 429 },
    );
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const {
    email = "",
    password = "",
    confirmPassword = "",
    name = "",
    city = "",
    country = "",
    language = "",
    telegram = "",
    phone = "",
    promoCode = "",
  } = body;

  // ── Валидация полей ───────────────────────────────────────────────────────
  const errors: Record<string, string> = {};

  if (!isValidEmail(email)) errors.email = "Некорректный email";
  if (!isValidName(name)) errors.name = "Только буквы, пробелы, дефисы; 2–200 символов";
  if (!city.trim() || city.trim().length < 2) errors.city = "Укажите город (минимум 2 символа)";
  if (!country.trim() || country.trim().length < 2) errors.country = "Укажите страну";
  if (!language.trim()) errors.language = "Выберите язык";
  // Telegram необязателен, но если указан — валидируем формат
  if (telegram.trim() && !isValidTelegram(telegram))
    errors.telegram = "Формат: @username (5–32 символа, a-z/0-9/_)";
  if (!isValidPhone(phone)) errors.phone = "Формат: +7XXXXXXXXXX";
  if (!isStrongPassword(password))
    errors.password = "Минимум 8 символов, хотя бы одна цифра или спецсимвол";
  if (password !== confirmPassword) errors.confirmPassword = "Пароли не совпадают";

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: "Ошибка валидации", errors }, { status: 400 });
  }

  // ── Проверка уникальности email ───────────────────────────────────────────
  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ошибка валидации", errors: { email: "Этот email уже зарегистрирован" } },
      { status: 400 },
    );
  }

  // ── Промокод → роль модератора ────────────────────────────────────────────
  let role = ROLES.USER;
  if (promoCode.trim()) {
    const promo = await (prisma as any).promoCode.findUnique({
      where: { code: promoCode.trim() },
    });
    if (!promo) {
      return NextResponse.json(
        { error: "Ошибка валидации", errors: { promoCode: "Промокод не найден или уже использован" } },
        { status: 400 },
      );
    }
    role = ROLES.MODERATOR;
    // Удаляем промокод — он одноразовый
    await (prisma as any).promoCode.delete({ where: { id: promo.id } });
  }

  // ── Создаём пользователя ──────────────────────────────────────────────────
  const passwordHash = await hashPassword(password);
  const verifyToken = randomBytes(32).toString("hex");
  const verifyExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 ч

  const rawTelegram = telegram.trim();
  const normalizedTelegram = rawTelegram
    ? rawTelegram.startsWith("@") ? rawTelegram : `@${rawTelegram}`
    : null;

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      password: passwordHash,
      role,
      name: name.trim(),
      city: city.trim(),
      country: country.trim(),
      language: language.trim(),
      telegram: normalizedTelegram,
      phone: phone.trim().replace(/[\s\-()]/g, ""),
      emailVerified: false,
      emailVerifyToken: verifyToken,
      emailVerifyExpiresAt: verifyExpiresAt,
    },
    select: { id: true, email: true },
  });

  // ── Создаём системные плейлисты ──────────────────────────────────────────
  await (prisma as any).playlist.createMany({
    data: [
      { userId: user.id, name: "Избранное", type: "favorites", isSystem: true },
      { userId: user.id, name: "Загруженное", type: "uploads", isSystem: true },
    ],
  });

  // ── Отправляем письмо верификации ─────────────────────────────────────────
  try {
    await sendVerificationEmail(user.email, verifyToken);
  } catch (err) {
    console.error("[register] Email send failed:", err);
    // Не фейлим регистрацию из-за проблем с email
  }

  return NextResponse.json(
    { success: true, message: "Аккаунт создан. Проверьте email для подтверждения." },
    { status: 201 },
  );
}
