"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Ссылка недействительна — токен не указан.");
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setStatus("success");
          setMessage(d.message || "Email подтверждён!");
        } else {
          setStatus("error");
          setMessage(d.error || "Ошибка подтверждения.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Ошибка соединения. Попробуйте снова.");
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div
          className={`inline-flex items-center justify-center w-16 h-16 rounded-xl text-white text-2xl mb-6 ${
            status === "loading"
              ? "bg-gray-700"
              : status === "success"
              ? "bg-gradient-to-br from-green-600 to-green-800"
              : "bg-gradient-to-br from-red-600 to-red-800"
          }`}
        >
          {status === "loading" ? (
            <div className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : status === "success" ? (
            "✓"
          ) : (
            "✕"
          )}
        </div>

        <h1 className="text-2xl font-bold text-white mb-3">
          {status === "loading"
            ? "Проверяем ссылку..."
            : status === "success"
            ? "Email подтверждён!"
            : "Ошибка подтверждения"}
        </h1>

        <p className="text-gray-400 mb-6">{message}</p>

        {status === "success" && (
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-gradient-to-br from-purple-600 to-purple-800 text-white font-medium rounded-lg hover:from-purple-500 hover:to-purple-700 transition-all"
          >
            Войти в аккаунт
          </Link>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <Link
              href="/login"
              className="block px-6 py-3 bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white rounded-lg transition-colors"
            >
              На страницу входа
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-gray-400">Загрузка...</div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
