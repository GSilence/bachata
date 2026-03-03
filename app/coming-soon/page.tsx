"use client";

import { useRouter } from "next/navigation";

export default function ComingSoonPage() {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 text-white font-bold text-2xl mb-6">
          B
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          Bachata Beat Counter
        </h1>
        <p className="text-gray-300 text-lg mb-2">Скоро открываем!</p>
        <p className="text-gray-500 text-sm mb-8">
          Сервис сейчас на стадии тестирования. Мы сообщим вам, когда он будет
          готов к работе.
        </p>
        <button
          onClick={handleLogout}
          className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-sm rounded-lg transition-colors"
        >
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}
