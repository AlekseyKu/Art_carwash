const DISMISS_KEY = "art_pwa_install_hint_dismissed";

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
}

export function isInstallHintDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === "1";
}

export function dismissInstallHint(): void {
  localStorage.setItem(DISMISS_KEY, "1");
}

export { DISMISS_KEY };
