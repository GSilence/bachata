"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import Sidebar from "@/components/Sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      const redirect = encodeURIComponent(pathname || "/");
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [user, isLoading, router, pathname]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-0 lg:ml-64 pt-16 lg:pt-0">{children}</main>
    </div>
  );
}
