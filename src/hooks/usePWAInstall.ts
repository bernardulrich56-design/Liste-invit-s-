import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as NavigatorWithStandalone).standalone)
    );
  });

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as Window & { MSStream?: unknown }).MSStream;

  const isAndroid =
    typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

  const isInIframe =
    typeof window !== 'undefined' &&
    (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

  useEffect(() => {
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as NavigatorWithStandalone).standalone);
      setIsInstalled(standalone);
    };

    checkStandalone();

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => checkStandalone();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener('change', handleDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', handleDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isIOS,
    isAndroid,
    isInIframe,
    install,
  };
}
