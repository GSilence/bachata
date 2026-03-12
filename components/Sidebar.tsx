"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { isAdmin, isModerator } from "@/lib/roles";
import { useModeratorStore } from "@/store/moderatorStore";
import { usePlayerStore } from "@/store/playerStore";

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  dimmed?: boolean;
}

const navItems: NavItem[] = [
  {
    name: "Воспроизведение",
    href: "/",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

const userNavItems: NavItem[] = [
  {
    name: "Уведомления",
    href: "/notifications",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    name: "Настройки",
    href: "/settings",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const adminNavItems: NavItem[] = [
  {
    name: "Медиатека",
    href: "/library",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
  {
    name: "Пользователи",
    href: "/admin/users",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    name: "Уведомления",
    href: "/admin/notifications",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    name: "Логи",
    href: "/admin/logs",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    name: "Управление",
    href: "/admin/manage",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
];

const PLAYLISTS = [
  {
    id: "general",
    name: "Общий",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    ),
  },
  {
    id: "favorites",
    name: "Избранное",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    id: "bookmarks",
    name: "Закладки",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const { user, isLoading, logout } = useAuthStore();
  const playlistPanelRef = useRef<HTMLDivElement>(null);
  const playlistBtnRef = useRef<HTMLButtonElement>(null);

  const isOnHome = pathname === "/";
  const isAdminUser = isAdmin(user?.role);
  const isModeratorUser = isModerator(user?.role);

  const { isModerating, enterModeratorMode, exitModeratorMode, isAdminMode, enterAdminMode, exitAdminMode } = useModeratorStore();
  const setVoiceFilter = usePlayerStore((s) => s.setVoiceFilter);

  const handleLogout = async () => {
    exitModeratorMode();
    await logout();
    setIsMobileMenuOpen(false);
  };

  // Close playlist panel on outside click
  useEffect(() => {
    if (!showPlaylists) return;
    const handler = (e: MouseEvent) => {
      if (
        playlistPanelRef.current &&
        !playlistPanelRef.current.contains(e.target as Node) &&
        playlistBtnRef.current &&
        !playlistBtnRef.current.contains(e.target as Node)
      ) {
        setShowPlaylists(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPlaylists]);

  // Close playlists when sidebar collapses
  useEffect(() => {
    if (!isHovered) setShowPlaylists(false);
  }, [isHovered]);

  const displayName = user?.name || user?.email?.split("@")[0] || "Пользователь";
  const roleLabel = isAdmin(user?.role)
    ? "Администратор"
    : isModerator(user?.role)
    ? "Модератор"
    : null;
  const tariff = "Базовый";

  // collapsed = on lg screens but below 'sidebar' breakpoint, and not hovered
  // We'll use CSS for layout, but need isHovered for the expand-on-hover overlay

  const renderNavItems = (items: NavItem[], collapsed: boolean) =>
    items.map((item) => {
      const isActive = pathname === item.href;
      return (
        <li key={item.href}>
          <Link
            href={item.href}
            onClick={() => setIsMobileMenuOpen(false)}
            title={collapsed ? item.name : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
              isActive
                ? "bg-purple-600/20 text-white border border-purple-500/30"
                : "text-gray-400 hover:bg-gray-800 hover:text-white"
            } ${collapsed ? "justify-center" : ""}`}
          >
            <span className={`shrink-0 ${isActive ? "text-purple-400" : ""}`}>{item.icon}</span>
            {!collapsed && <span className="flex-1 text-sm whitespace-nowrap">{item.name}</span>}
          </Link>
        </li>
      );
    });

  // Sidebar content — shared between mobile full and desktop states
  const sidebarContent = (collapsed: boolean) => (
    <>
      {/* ── Top bar: Back + Logout/Login ── */}
      <div className={`flex items-center ${collapsed ? "justify-center px-2" : "justify-between px-4"} py-3 border-b border-gray-800/60`}>
        {/* Back button */}
        {collapsed ? (
          <button
            onClick={() => { if (!isOnHome) router.back(); }}
            disabled={isOnHome}
            title={isOnHome ? "Вы на главной" : "Назад"}
            className={`p-1.5 rounded-lg transition-colors ${
              isOnHome
                ? "text-gray-700 cursor-default"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : (
          <>
            <button
              onClick={() => { if (!isOnHome) router.back(); }}
              disabled={isOnHome}
              title={isOnHome ? "Вы на главной" : "Назад"}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                isOnHome
                  ? "text-gray-700 cursor-default"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Назад
            </button>

            {/* Auth button */}
            {!isLoading && (
              user ? (
                <button
                  onClick={handleLogout}
                  title="Выйти"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Выйти
                </button>
              ) : (
                <Link
                  href="/login"
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Войти · Регистрация
                </Link>
              )
            )}
          </>
        )}
      </div>

      {/* ── Logo ── */}
      <div className={`${collapsed ? "px-2 py-4" : "px-6 py-4"} border-b border-gray-800/60`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2.5"}`}>
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-purple-800 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-lg leading-none">B</span>
          </div>
          {!collapsed && <span className="text-white text-xl font-semibold whitespace-nowrap">Bachata</span>}
        </div>
      </div>

      {/* ── Playlists button ── */}
      {user && (
        <div className={`${collapsed ? "px-2" : "px-4"} pt-4 pb-2`}>
          {collapsed ? (
            <button
              ref={playlistBtnRef}
              onClick={() => setShowPlaylists(!showPlaylists)}
              title="Плейлисты"
              className={`w-full flex items-center justify-center p-2.5 rounded-xl text-sm font-medium transition-colors ${
                showPlaylists
                  ? "bg-purple-600/20 text-white border border-purple-500/30"
                  : "bg-gray-800/60 text-gray-300 hover:bg-gray-700/80 hover:text-white border border-transparent"
              }`}
            >
              <svg className={`w-5 h-5 ${showPlaylists ? "text-purple-400" : "text-gray-500"}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h10" />
              </svg>
            </button>
          ) : (
            <button
              ref={playlistBtnRef}
              onClick={() => setShowPlaylists(!showPlaylists)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                showPlaylists
                  ? "bg-purple-600/20 text-white border border-purple-500/30"
                  : "bg-gray-800/60 text-gray-300 hover:bg-gray-700/80 hover:text-white border border-transparent"
              }`}
            >
              <svg className={`w-5 h-5 ${showPlaylists ? "text-purple-400" : "text-gray-500"}`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h10" />
              </svg>
              <span className="flex-1 text-left whitespace-nowrap">Плейлисты</span>
              <svg className={`w-4 h-4 transition-transform ${showPlaylists ? "rotate-180 text-purple-400" : "text-gray-600"}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── Navigation ── */}
      <nav className={`${collapsed ? "px-2" : "px-4"} pt-4 flex-1 overflow-y-auto`}>
        {!isModerating && (
          <>
            {!collapsed && <p className="px-3 mb-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">Меню</p>}
            <ul className="space-y-0.5">
              {renderNavItems(navItems, collapsed)}
            </ul>
          </>
        )}

        {/* User section — same block as main nav */}
        {user && (
          <ul className="space-y-0.5 mt-0.5">
            {renderNavItems(userNavItems, collapsed)}
          </ul>
        )}

        {/* Admin section */}
        {isAdminUser && (
          <div className="mt-6 pt-4 border-t border-gray-800/60">
            {!collapsed && <p className="px-3 mb-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">Администрирование</p>}
            <ul className="space-y-0.5">
              {renderNavItems(adminNavItems, collapsed)}
            </ul>
          </div>
        )}

      </nav>

      {/* ── Bottom: user card + moderator toggle ── */}
      <div className={`${collapsed ? "p-2" : "p-4"} border-t border-gray-800/60`}>
        {isLoading ? (
          <div className="px-3 py-2 text-sm text-gray-600">...</div>
        ) : user ? (
          collapsed ? (
            <div className="flex justify-center py-2">
              <div className="w-9 h-9 rounded-full bg-gray-700/80 flex items-center justify-center shrink-0 border border-gray-600/40" title={displayName}>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/60 transition-colors cursor-default">
              {/* Avatar placeholder */}
              <div className="w-10 h-10 rounded-full bg-gray-700/80 flex items-center justify-center shrink-0 border border-gray-600/40">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="overflow-hidden min-w-0">
                <p className="text-white text-sm font-medium truncate">{displayName}</p>
                <p className="text-gray-500 text-xs truncate">
                  {roleLabel ? (
                    <>{roleLabel} <span className="mx-1">·</span> {tariff}</>
                  ) : tariff}
                </p>
              </div>
            </div>
          )
        ) : (
          collapsed ? (
            <Link
              href="/login"
              onClick={() => setIsMobileMenuOpen(false)}
              title="Войти"
              className="flex justify-center py-2 text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
            </Link>
          ) : (
            <Link
              href="/login"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-800/60 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Войти / Зарегистрироваться
            </Link>
          )
        )}

        {/* Moderator mode toggle — below profile */}
        {isModeratorUser && (
          <div className="mt-2">
            {isModerating ? (
              <button
                onClick={() => { exitModeratorMode(); router.push("/"); setIsMobileMenuOpen(false); }}
                title={collapsed ? "Выйти из режима" : undefined}
                className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2.5 rounded-xl text-sm text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20 transition-colors border border-yellow-500/20`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {!collapsed && <span className="whitespace-nowrap">Выйти из режима</span>}
              </button>
            ) : (
              <button
                onClick={() => { enterModeratorMode(); setVoiceFilter("on1"); router.push("/moderate"); setIsMobileMenuOpen(false); }}
                title={collapsed ? "Режим модератора" : undefined}
                className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2.5 rounded-xl text-sm text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {!collapsed && <span className="whitespace-nowrap">Режим модератора</span>}
              </button>
            )}
          </div>
        )}

        {/* Admin mode toggle — admin only */}
        {isAdminUser && (
          <div className="mt-2">
            {isAdminMode ? (
              <button
                onClick={() => { exitAdminMode(); setIsMobileMenuOpen(false); }}
                title={collapsed ? "Выйти из адм. режима" : undefined}
                className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2.5 text-sm text-blue-300 bg-blue-400/10 hover:bg-blue-400/20 transition-colors border border-blue-500/20`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {!collapsed && <span className="whitespace-nowrap">Выйти из адм. режима</span>}
              </button>
            ) : (
              <button
                onClick={() => { enterAdminMode(); setIsMobileMenuOpen(false); }}
                title={collapsed ? "Режим администратора" : undefined}
                className={`w-full flex items-center gap-3 ${collapsed ? "justify-center px-2" : "px-3"} py-2.5 text-sm text-gray-500 hover:text-blue-300 hover:bg-blue-400/10 transition-colors`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {!collapsed && <span className="whitespace-nowrap">Режим администратора</span>}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-gray-800 rounded-lg text-white hover:bg-gray-700 transition-colors"
        aria-label="Toggle menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isMobileMenuOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Playlist slide-out panel — positioned next to current sidebar width */}
      {showPlaylists && (
        <div
          ref={playlistPanelRef}
          className="fixed top-0 h-screen w-64 bg-gray-850 border-r border-gray-700/60 z-40 flex flex-col shadow-2xl"
          style={{
            left: isHovered || isMobileMenuOpen ? "256px" : "256px",
            backgroundColor: "rgb(var(--bg-sidebar-panel))",
          }}
        >
          <div className="px-5 py-4 border-b border-gray-700/60 flex items-center justify-between">
            <h3 className="text-white font-semibold text-base">Плейлисты</h3>
            <button
              onClick={() => setShowPlaylists(false)}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ul className="p-3 space-y-1 flex-1">
            {PLAYLISTS.map((pl) => (
              <li key={pl.id}>
                <button
                  onClick={() => {
                    usePlayerStore.getState().setActivePlaylist(pl.id);
                    setShowPlaylists(false);
                    if (pathname !== "/") router.push("/");
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-300 hover:bg-gray-700/60 hover:text-white transition-colors text-sm text-left"
                >
                  <span className="text-gray-500">{pl.icon}</span>
                  {pl.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Desktop collapsed sidebar (lg to sidebar breakpoint) ── */}
      {/* This is the icon-only strip, always visible on lg+, hidden on sidebar+ */}
      <aside
        className="hidden lg:flex sidebar:hidden w-16 h-screen fixed left-0 top-0 flex-col z-30"
        style={{ backgroundColor: "rgb(var(--bg-sidebar))" }}
      >
        {sidebarContent(true)}
      </aside>

      {/* ── Desktop collapsed hover overlay (lg to sidebar breakpoint) ── */}
      {/* When hovering the collapsed sidebar area, show expanded overlay */}
      {isHovered && (
        <div className="hidden lg:block sidebar:hidden fixed inset-0 z-40" onClick={() => setIsHovered(false)} />
      )}
      <aside
        className="hidden lg:flex sidebar:hidden w-64 h-screen fixed left-0 top-0 flex-col z-50 shadow-2xl transition-transform duration-200 ease-out"
        style={{
          backgroundColor: "rgb(var(--bg-sidebar))",
          transform: isHovered ? "translateX(0)" : "translateX(-100%)",
          pointerEvents: isHovered ? "auto" : "none",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {sidebarContent(false)}
      </aside>

      {/* Hover trigger zone over collapsed sidebar */}
      <div
        className="hidden lg:block sidebar:hidden fixed left-0 top-0 w-16 h-screen z-40"
        onMouseEnter={() => setIsHovered(true)}
      />

      {/* ── Desktop full sidebar (sidebar breakpoint and above) ── */}
      <aside
        className="hidden sidebar:flex w-64 h-screen fixed left-0 top-0 flex-col z-50"
        style={{ backgroundColor: "rgb(var(--bg-sidebar))" }}
      >
        {sidebarContent(false)}
      </aside>

      {/* ── Mobile full sidebar ── */}
      <aside
        className={`
          lg:hidden w-64 h-screen fixed left-0 top-0 flex flex-col z-50
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        style={{ backgroundColor: "rgb(var(--bg-sidebar))" }}
      >
        {sidebarContent(false)}
      </aside>
    </>
  );
}
