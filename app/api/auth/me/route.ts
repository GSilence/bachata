import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;

  if (!token) {
    return NextResponse.json({ user: null });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ user: null });
  }

  if (!prisma) {
    return NextResponse.json({
      user: { id: payload.userId, email: payload.email, role: payload.role },
    });
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        city: true,
        country: true,
        language: true,
        telegram: true,
        phone: true,
      },
    });

    if (!dbUser) {
      return NextResponse.json({
        user: { id: payload.userId, email: payload.email, role: payload.role },
      });
    }

    return NextResponse.json({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        role: dbUser.role,
        name: dbUser.name ?? undefined,
        city: dbUser.city ?? undefined,
        country: dbUser.country ?? undefined,
        language: dbUser.language ?? undefined,
        telegram: dbUser.telegram ?? undefined,
        phone: dbUser.phone ?? undefined,
      },
    });
  } catch (err) {
    // Миграция не применена (нет колонок профиля) или ошибка БД — отдаём хотя бы данные из токена
    console.warn("[auth/me] DB error, falling back to token payload:", err);
    return NextResponse.json({
      user: { id: payload.userId, email: payload.email, role: payload.role },
    });
  }
}
