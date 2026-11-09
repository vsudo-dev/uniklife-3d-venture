"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ul-install-dismissed-at";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Registers the service worker, offers a SAFE update (user-confirmed), and shows an
 * install invitation only when the browser reports the app is installable
 * (beforeinstallprompt) — or iOS "Add to Home Screen" instructions on iOS Safari.
 * Installation is always a user action; it cannot happen silently.
 */
export function PwaRegister() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Marker that client-side hydration finished (used by browser tests and diagnostics).
    document.documentElement.dataset.hydrated = "1";
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Service workers require a secure context (HTTPS or localhost).
    if (!window.isSecureContext) return;
    let reg: ServiceWorkerRegistration | undefined;
    // Only an UPDATE (replacing an existing controller) should reload the page — never the
    // first install, when the new worker merely claims an uncontrolled page.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((r) => {
        reg = r;
        if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
        r.addEventListener("updatefound", () => {
          const nw = r.installing;
          nw?.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
      })
      .catch(() => undefined);
    let reloaded = false;
    const onController = () => {
      if (reloaded || !hadController) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    const interval = window.setInterval(() => reg?.update().catch(() => undefined), 60 * 60 * 1000);
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const dismissedAt = Number(safeGet(DISMISS_KEY) ?? 0);
    const recentlyDismissed = Date.now() - dismissedAt < 7 * 24 * 3600 * 1000;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (!recentlyDismissed) setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari && !recentlyDismissed) {
      const t = window.setTimeout(() => setShowIos(true), 30000); // let people use the app first
      return () => {
        window.clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onPrompt);
      };
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const dismiss = () => {
    safeSet(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
    setShowIos(false);
  };

  return (
    <>
      {offline && (
        <div role="status" className="fixed inset-x-0 top-0 z-[60] bg-warning px-4 py-1.5 text-center text-xs font-semibold text-white safe-top">
          You are offline. Data shown may be out of date; bookings and payments need a connection.
        </div>
      )}
      {waiting && (
        <div role="dialog" aria-label="Update available" className="fixed bottom-20 left-1/2 z-[60] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-border bg-surface p-4 shadow-[var(--glow)] md:bottom-6">
          <div className="text-sm font-bold">A new version is available</div>
          <p className="mt-1 text-xs text-muted">Save any unsaved work, then reload to update.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted" onClick={() => setWaiting(null)}>Later</button>
            <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>
              Reload &amp; update
            </button>
          </div>
        </div>
      )}
      {deferred && (
        <div role="dialog" aria-label="Install app" data-testid="install-invite" className="fixed bottom-20 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-border bg-surface p-4 shadow-[var(--glow)] md:bottom-6">
          <div className="text-sm font-bold">Install this app</div>
          <p className="mt-1 text-xs text-muted">Add it to your home screen for quick access, full-screen use and notifications.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted" onClick={dismiss}>Not now</button>
            <button
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white"
              onClick={async () => {
                await deferred.prompt();
                await deferred.userChoice.catch(() => undefined);
                setDeferred(null);
              }}
            >
              Install
            </button>
          </div>
        </div>
      )}
      {showIos && (
        <div role="dialog" aria-label="Add to Home Screen" data-testid="ios-install" className="fixed bottom-20 left-1/2 z-50 w-[min(92vw,380px)] -translate-x-1/2 rounded-2xl border border-border bg-surface p-3 text-sm shadow-[var(--glow)] lg:bottom-6">
          <div className="text-sm font-bold">Add to Home Screen</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>Tap the <strong>Share</strong> button in Safari&apos;s toolbar.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
          <div className="mt-3 flex justify-end">
            <button className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted" onClick={dismiss}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}
