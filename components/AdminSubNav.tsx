"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SubNavItem {
  href: string;
  label: string;
}

const LIBRARY_ITEMS: SubNavItem[] = [
  { href: "/library", label: "Загрузка" },
  { href: "/admin/duplicates", label: "Дубликаты" },
  { href: "/admin/mod-queue", label: "Очередь модерации" },
  { href: "/admin/upload-queue", label: "Очередь загрузки" },
];

const USERS_ITEMS: SubNavItem[] = [
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/promo-codes", label: "Промокоды" },
];

const GROUPS: Record<string, SubNavItem[]> = {
  library: LIBRARY_ITEMS,
  users: USERS_ITEMS,
};

export default function AdminSubNav({ group }: { group: "library" | "users" }) {
  const pathname = usePathname();
  const items = GROUPS[group];

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-5">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                : "bg-gray-800/60 text-gray-400 hover:bg-gray-700 hover:text-white border border-transparent"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
