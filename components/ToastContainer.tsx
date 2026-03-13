"use client";

import { useToastStore, Toast } from "@/store/toastStore";
import { useEffect, useState } from "react";

const typeStyles: Record<NonNullable<Toast["type"]>, string> = {
  info: "bg-gray-800/95 border-gray-600 text-gray-100",
  success: "bg-emerald-900/95 border-emerald-600 text-emerald-100",
  error: "bg-red-900/95 border-red-600 text-red-100",
  warning: "bg-amber-900/95 border-amber-600 text-amber-100",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const hideTimer = setTimeout(() => setVisible(false), (toast.duration ?? 2500) - 300);
    return () => clearTimeout(hideTimer);
  }, [toast.duration]);

  return (
    <>
      {/* Mobile: full-width bar sliding up from bottom */}
      <div
        onClick={onDismiss}
        className={`
          md:hidden fixed left-0 right-0 bottom-0 z-[200]
          flex items-center justify-center
          py-2.5 border-t backdrop-blur-md cursor-pointer
          transition-all duration-300 ease-out text-sm font-normal
          ${typeStyles[toast.type ?? "info"]}
          ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"}
        `}
      >
        {toast.message}
      </div>
      {/* Desktop: compact floating pill */}
      <div
        onClick={onDismiss}
        className={`
          hidden md:block
          px-4 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm cursor-pointer
          transition-all duration-300 ease-out text-sm font-medium
          ${typeStyles[toast.type ?? "info"]}
          ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
        `}
      >
        {toast.message}
      </div>
    </>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <>
      {/* Mobile toasts render fixed from ToastItem itself */}
      {/* Desktop: positioned container */}
      <div className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
      {/* Mobile: render each toast (they position themselves) */}
      <div className="md:hidden">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </>
  );
}
