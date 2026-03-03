import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken, setAuthCookie, verifyPassword } from "@/lib/auth";
import { checkRateLimit, getRetryAfter } from "@/lib/rateLimiter";

export async function POST(request: NextRequest) {
  // Rate limiting: 10 попыток входа с одного IP за 15 минут
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (!checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json(
      { error: `Слишком много попыток входа. Подождите ${getRetryAfter(`login:${ip}`)} сек.` },
      { status: 429 },
    );
  }

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email и пароль обязательны" },
        { status: 400 },
      );
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 500 });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: {
        id: true,
        email: true,
        password: true,
        role: true,
        isBanned: true,
        bannedReason: true,
        emailVerified: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 },
      );
    }

    if (user.isBanned) {
      const reason = user.bannedReason ? `: ${user.bannedReason}` : "";
      return NextResponse.json(
        { error: `Аккаунт заблокирован${reason}` },
        { status: 403 },
      );
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Неверный email или пароль" },
        { status: 401 },
      );
    }

    // Проверка верификации email (admin всегда может войти)
    if (!user.emailVerified && user.role !== "admin") {
      return NextResponse.json(
        { error: "Подтвердите email. Проверьте почту и перейдите по ссылке из письма.", unverified: true },
        { status: 403 },
      );
    }

    const token = await signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, role: user.role },
    });

    setAuthCookie(response, token);
    return response;
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return NextResponse.json(
      { error: "Ошибка сервера" },
      { status: 500 },
    );
  }
}
