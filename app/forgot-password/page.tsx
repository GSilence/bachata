"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok && res.status !== 429) {
        setError(data.error || "Ошибка");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Ошибка соединения. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-green-600 to-green-800 text-white text-2xl mb-6">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Письмо отправлено</h1>
          <p className="text-gray-400 mb-6">
            Если email <strong className="text-white">{email}</strong> зарегистрирован,
            вам придёт письмо со ссылкой для сброса пароля.
            <br />
            <span className="text-sm">Ссылка действует 1 час.</span>
          </p>
          <p className="text-gray-500 text-sm mb-6">Проверьте папку «Спам», если письмо не пришло.</p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white rounded-lg transition-colors"
          >
            ← На страницу входа
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 text-white font-bold text-xl mb-4">
            B
          </div>
          <h1 className="text-2xl font-bold text-white">Забыли пароль?</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Введите email — отправим ссылку для восстановления
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4"
        >
          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="email@example.com"
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !email}
            className="w-full py-2.5 bg-gradient-to-br from-purple-600 to-purple-800 hover:from-purple-500 hover:to-purple-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Отправляем..." : "Отправить ссылку"}
          </button>
        </form>

        <div className="text-center mt-4">
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
            ← Вернуться ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}
