// Install (US001, architecture §6): our own "Install app" button where the browser offers it
// (beforeinstallprompt), and short guides where it does not.
import { create } from 'zustand';

/** Chrome / Edge's install event (not in lib.dom). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  'installed' | 'prompt' | 'ios' | 'mac_safari' | 'firefox_desktop' | 'none';

export interface InstallEnv {
  standalone: boolean;
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

export function installState(env: InstallEnv): InstallState {
  if (env.standalone) return 'installed';
  if (env.hasPrompt) return 'prompt';
  const ua = env.userAgent;
  const otherEngine = /CriOS|FxiOS|EdgiOS|Chrome|Chromium|Edg\/|Firefox/.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !otherEngine) return 'mac_safari';
  if (/Firefox/.test(ua) && !/Android|Mobile/.test(ua)) return 'firefox_desktop';
  return 'none';
}

export function browserInstallEnv(hasPrompt: boolean): InstallEnv {
  const standalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    standalone,
    hasPrompt,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

interface InstallStore {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
  set: (prompt: BeforeInstallPromptEvent | null) => void;
  markInstalled: () => void;
}

export const useInstallStore = create<InstallStore>((set) => ({
  prompt: null,
  installed: false,
  set: (prompt) => set({ prompt }),
  markInstalled: () => set({ installed: true, prompt: null }),
}));

/** Called once from main.tsx: keep the browser's install prompt for our own button. */
export function listenForInstallPrompt(target: Window = window) {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    useInstallStore.getState().set(event as BeforeInstallPromptEvent);
  });
  target.addEventListener('appinstalled', () => useInstallStore.getState().markInstalled());
}

export const INSTALL_DISMISSED_KEY = 'install_card_dismissed';
