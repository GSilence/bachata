import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

const COOKIE_NAME = "auth-token";

// Пути только для авторизованных (любая роль)
const AUTH_ONLY_PREFIXES = ["/music", "/uploads"];

// Пути главного приложения — закрыты для роли "user" (временно, на период доработок)
const APP_PREFIXES = ["/library", "/queue", "/admin"];

function isAuthOnlyPath(pathname: string): boolean {
  return AUTH_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
}

function isAppPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return APP_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(COOKIE_NAME)?.value;

  // ── /music, /uploads: только авторизованные ──────────────────────────
  if (isAuthOnlyPath(pathname)) {
    if (!token) {
      const login = new URL("/login", request.url);
      login.searchParams.set("redirect", pathname);
      return NextResponse.redirect(login);
    }
    const user = await verifyToken(token);
    if (!user) {
      const login = new URL("/login", request.url);
      login.searchParams.set("redirect", pathname);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  // ── Главное приложение: пользователи (role=user) → coming-soon ───────
  if (isAppPath(pathname)) {
    // Незалогиненные → логин
    if (!token) {
      const login = new URL("/login", request.url);
      login.searchParams.set("redirect", pathname);
      return NextResponse.redirect(login);
    }
    const user = await verifyToken(token);
    if (!user) {
      const login = new URL("/login", request.url);
      login.searchParams.set("redirect", pathname);
      return NextResponse.redirect(login);
    }
    // Роль "user" → coming-soon (без мелькания треков)
    if (user.role === "user") {
      return NextResponse.redirect(new URL("/coming-soon", request.url));
    }
    // Роль "moderator" на "/" → страница модерации
    if (user.role === "moderator" && pathname === "/") {
      return NextResponse.redirect(new URL("/moderate", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/library/:path*",
    "/queue/:path*",
    "/admin/:path*",
    "/moderate",
    "/music/:path*",
    "/uploads/:path*",
  ],
};
