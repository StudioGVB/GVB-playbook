import { toast } from 'sonner';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface NotificationOptionsCustom {
  body?: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

/** Check if Web Push / Notifications are supported by current browser */
export function checkNotificationSupport(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

/** Get current permission state */
export function getNotificationPermission(): NotificationPermissionState {
  if (!checkNotificationSupport()) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

/** Register service worker in browser */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!checkNotificationSupport()) return null;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.error('ServiceWorker registration failed:', err);
    return null;
  }
}

/** Request push notification permission from user */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!checkNotificationSupport()) {
    toast.error('Push Notifications are not supported on this browser.');
    return 'unsupported';
  }

  try {
    // First register service worker
    await registerServiceWorker();

    // Prompt for permission
    const permission = await Notification.requestPermission();

    if (permission === 'granted') {
      toast.success('Push notifications enabled! You will now receive budget & task alerts.');
      // Send welcome push notification
      await sendLocalNotification('Push Notifications Enabled! 🎉', {
        body: 'You are all set! GVB Playbook will keep you updated on budgets, goals, and tasks.',
        icon: '/favicon.png',
        url: '/settings',
      });
    } else if (permission === 'denied') {
      toast.error('Notification permission was blocked in your browser settings.');
    }

    return permission as NotificationPermissionState;
  } catch (err: any) {
    console.error('Failed to request notification permission:', err);
    toast.error('Failed to enable notifications: ' + (err?.message || 'Unknown error'));
    return getNotificationPermission();
  }
}

/** Send a local push notification using Service Worker or native Web Notification API */
export async function sendLocalNotification(
  title: string,
  options: NotificationOptionsCustom = {}
): Promise<boolean> {
  if (!checkNotificationSupport()) return false;
  if (Notification.permission !== 'granted') return false;

  const notifOptions: NotificationOptions = {
    body: options.body || '',
    icon: options.icon || '/favicon.png',
    badge: options.badge || '/favicon.png',
    data: options.url || '/',
    tag: options.tag || 'gvb-playbook-notif',
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return true;
      }
    }

    // Fallback to standard Notification constructor
    new Notification(title, notifOptions);
    return true;
  } catch (err) {
    console.error('Error triggering notification:', err);
    return false;
  }
}

/** Send an immediate test push notification */
export async function sendTestNotification(): Promise<void> {
  const perm = getNotificationPermission();
  if (perm !== 'granted') {
    const res = await requestNotificationPermission();
    if (res !== 'granted') return;
  }

  const success = await sendLocalNotification('⚡ Test Push Notification', {
    body: `Push notifications are working perfectly on GVB Playbook! (${new Date().toLocaleTimeString()})`,
    icon: '/favicon.png',
    url: '/finance/budget',
  });

  if (success) {
    toast.success('Test notification sent! Check your system banner.');
  } else {
    toast.error('Could not deliver test notification. Check browser settings.');
  }
}
