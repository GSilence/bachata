"use client";

import { useToastStore, Toast } from "@/store/toastStore";
import { useEffect, useState } from "react";

const typeStyles: Record<NonNullable<Toast["type"]>, string> = {
  info: "bg-gray-800 border-gray-600 text-gray-100",
  success: "bg-emerald-900/90 border-emerald-600 text-emerald-100",
  error: "bg-red-900/90 border-red-600 text-red-100",
  warning: "bg-amber-900/90 border-amber-600 text-amber-100",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true));
    // Animate out before removal
    const hideTimer = setTimeout(() => setVisible(false), (toast.duration ?? 2500) - 300);
    return () => clearTimeout(hideTimer);
  }, [toast.duration]);

  return (
    <div
      onClick={onDismiss}
      className={`
        px-4 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm cursor-pointer
        transition-all duration-300 ease-out text-sm font-medium
        ${typeStyles[toast.type ?? "info"]}
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
      `}
    >
      {toast.message}
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
