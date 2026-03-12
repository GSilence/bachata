"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useTheme, type ThemeName } from "@/lib/theme";

const THEMES: { id: ThemeName; name: string; description: string; colors: string[] }[] = [
  {
    id: "default",
    name: "Классическая",
    description: "Серые тона с фиолетовым акцентом",
    colors: ["#111827", "#1f2937", "#9333ea", "#a855f7"],
  },
  {
    id: "purple-night",
    name: "Purple Night",
    description: "Глубокий navy-purple с индиго-акцентом",
    colors: ["#161424", "#1e1c30", "#3c3abe", "#6462dc"],
  },
];

export default function UserSettingsPage() {
  const router = useRouter();
  const { user, isLoading, checkAuth } = useAuthStore();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login?redirect=/settings");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Загрузка...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-white mb-6">Настройки</h1>

      <div className="flex flex-wrap gap-6">

        {/* Тема оформления */}
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 w-full max-w-2xl">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            Тема оформления
          </h2>
          <p className="text-gray-400 text-sm mb-5">
            Выберите цветовую схему интерфейса.
          </p>

          <div className="flex flex-wrap gap-4">
            {THEMES.map((t) => {
              const isActive = theme === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all min-w-[200px] flex-1 text-left ${
                    isActive
                      ? "border-purple-500 bg-purple-600/10"
                      : "border-gray-700 bg-gray-800/30 hover:border-gray-500 hover:bg-gray-800/60"
                  }`}
                >
                  {/* Color preview */}
                  <div className="flex gap-1.5 mb-3">
                    {t.colors.map((c, i) => (
                      <div
                        key={i}
                        className="w-7 h-7 rounded-lg border border-white/10"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <span className="text-white font-medium text-sm">{t.name}</span>
                  <span className="text-gray-500 text-xs mt-0.5">{t.description}</span>
                  {isActive && (
                    <div className="absolute top-3 right-3">
                      <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
