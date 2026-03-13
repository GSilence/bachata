import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  type?: "info" | "success" | "error" | "warning";
  duration?: number; // ms, default 2500
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, opts?: { type?: Toast["type"]; duration?: number }) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  show: (message, opts) => {
    const id = `toast_${++counter}_${Date.now()}`;
    const duration = opts?.duration ?? 2500;
    const toast: Toast = { id, message, type: opts?.type ?? "info", duration };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismiss(id), duration);
  },

  dismiss: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Shorthand helper */
export const toast = {
  info: (msg: string, duration?: number) => useToastStore.getState().show(msg, { type: "info", duration }),
  success: (msg: string, duration?: number) => useToastStore.getState().show(msg, { type: "success", duration }),
  error: (msg: string, duration?: number) => useToastStore.getState().show(msg, { type: "error", duration }),
  warning: (msg: string, duration?: number) => useToastStore.getState().show(msg, { type: "warning", duration }),
};
