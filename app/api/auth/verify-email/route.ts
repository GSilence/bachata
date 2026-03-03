import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Токен не указан" }, { status: 400 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not available" }, { status: 500 });
  }

  const user = await prisma.user.findFirst({
    where: { emailVerifyToken: token },
    select: { id: true, emailVerified: true, emailVerifyExpiresAt: true },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Ссылка недействительна или уже использована" },
      { status: 400 },
    );
  }

  if (user.emailVerified) {
    return NextResponse.json({ success: true, message: "Email уже подтверждён" });
  }

  if (user.emailVerifyExpiresAt && user.emailVerifyExpiresAt < new Date()) {
    return NextResponse.json(
      { error: "Ссылка истекла. Запросите новое письмо с подтверждением." },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpiresAt: null,
    },
  });

  return NextResponse.json({ success: true, message: "Email подтверждён. Теперь вы можете войти." });
}
