"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/authStore";
import Sidebar from "@/components/Sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, checkAuth } = useAuthStore();
  const didCheck = useRef(false);

  // Single checkAuth call for the entire (main) layout
  useEffect(() => {
    if (!didCheck.current) {
      didCheck.current = true;
      checkAuth();
    }
  }, [checkAuth]);

  // Show loading until auth check completes (user may or may not exist)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-0 lg:ml-64 pt-16 lg:pt-0">{children}</main>
    </div>
  );
}
