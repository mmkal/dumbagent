type ToastTone = "info" | "success" | "error";

type ToastInput = {
  id?: string;
  title: string;
  message?: string;
  tone?: ToastTone;
  durationMs?: number;
  testId?: string;
};

let toastViewport: HTMLElement | null = null;
const activeToasts = new Map<string, HTMLElement>();

export function showToast(input: ToastInput) {
  const id = input.id || `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existing = activeToasts.get(id);
  if (existing) {
    existing.remove();
    activeToasts.delete(id);
  }

  const tone = input.tone || "info";
  const toast = document.createElement("div");
  toast.className = `app-toast app-toast-${tone}`;
  toast.dataset.state = "entering";
  toast.setAttribute("role", tone === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", tone === "error" ? "assertive" : "polite");
  if (input.testId) {
    toast.dataset.testid = input.testId;
  }

  const title = document.createElement("strong");
  title.textContent = input.title;
  toast.append(title);

  if (input.message) {
    const message = document.createElement("span");
    message.textContent = input.message;
    toast.append(message);
  }

  activeToasts.set(id, toast);
  getToastViewport().append(toast);
  requestAnimationFrame(() => {
    toast.dataset.state = "open";
  });

  window.setTimeout(() => {
    dismissToast(id, toast);
  }, input.durationMs || 6_000);

  return id;
}

function dismissToast(id: string, toast: HTMLElement) {
  if (!activeToasts.has(id)) {
    return;
  }
  toast.dataset.state = "closed";
  window.setTimeout(() => {
    if (activeToasts.get(id) === toast) {
      activeToasts.delete(id);
      toast.remove();
    }
  }, 180);
}

function getToastViewport() {
  if (toastViewport && document.body.contains(toastViewport)) {
    return toastViewport;
  }
  toastViewport = document.createElement("div");
  toastViewport.className = "toast-viewport";
  toastViewport.setAttribute("aria-label", "Notifications");
  document.body.append(toastViewport);
  return toastViewport;
}
