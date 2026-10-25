// ==============================================================================
// CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
// Web Push Notifications Client Library
// Developed by CT | Built by Ayush Kumar
// Standards-compliant W3C Push API integration with VAPID authentication
// ==============================================================================

import { supabase } from './supabase';
import { PushDeviceType, PushSubscriptionRecord } from '../types/database';

// Production VAPID Public Key (Safe for client-side inclusion)
export const DEFAULT_VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BAzjcKuwT3O_kYn4Y1zcpgViGDT-L6qwK3krr3LQspiSaIL11uih8SY1i02Jy0xvnmRnnseg9CIimv-cvYA8zQ4';

/**
 * Converts a URL-safe Base64 string to a Uint8Array for applicationServerKey.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks whether Web Push Notifications are supported in the current browser.
 */
export function isPushNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Detects the client device type for analytics and display.
 */
export function detectDeviceType(): PushDeviceType {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/windows|macintosh|linux/.test(ua)) return 'desktop';
  return 'other';
}

/**
 * Gets the current browser Notification permission status.
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

/**
 * Requests browser permission and subscribes the user to Web Push.
 * Stores the subscription endpoint securely in Supabase under auth.uid().
 */
export async function subscribeUserToPush(
  userId: string,
  vapidPublicKey: string = DEFAULT_VAPID_PUBLIC_KEY
): Promise<{ success: boolean; subscription?: PushSubscriptionRecord; error?: string }> {
  if (!isPushNotificationSupported()) {
    return {
      success: false,
      error: 'Web Push Notifications are not supported by this browser or platform.'
    };
  }

  try {
    // 1. Request Browser Notification Permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error:
          permission === 'denied'
            ? 'Notification permission was denied. Please allow notifications in your browser or site settings.'
            : 'Notification permission request was dismissed.'
      };
    }

    // 2. Wait for Service Worker Ready
    const registration = await navigator.serviceWorker.ready;
    if (!registration) {
      return {
        success: false,
        error: 'Active Service Worker was not found. Please refresh the page.'
      };
    }

    // 3. Subscribe with VAPID Public Key
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
    let browserSub = await registration.pushManager.getSubscription();

    if (!browserSub) {
      browserSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource
      });
    }

    const subJson = browserSub.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
      return {
        success: false,
        error: 'Failed to extract push encryption keys from browser subscription.'
      };
    }

    const deviceType = detectDeviceType();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

    // 4. Save / Upsert in Supabase public.push_subscriptions
    const { data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
          device_type: deviceType,
          user_agent: userAgent,
          is_active: true,
          attendance_reminders_enabled: true,
          attendance_status_updates_enabled: true,
          absence_alerts_enabled: true,
          last_used_at: new Date().toISOString()
        },
        { onConflict: 'endpoint' }
      )
      .select()
      .single();

    if (error) {
      console.error('[WebPush] Error saving subscription in Supabase:', error);
      return {
        success: false,
        error: `Database save failed: ${error.message}`
      };
    }

    return {
      success: true,
      subscription: data as PushSubscriptionRecord
    };
  } catch (err: unknown) {
    console.error('[WebPush] Subscription error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown push subscription error'
    };
  }
}

/**
 * Unsubscribes the user's active device from Web Push and deactivates it in Supabase.
 */
export async function unsubscribeUserFromPush(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!isPushNotificationSupported()) {
    return { success: true };
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const browserSub = await registration.pushManager.getSubscription();

    if (browserSub) {
      const endpoint = browserSub.endpoint;
      // Unsubscribe from browser push manager
      await browserSub.unsubscribe();

      // Deactivate in Supabase
      await supabase
        .from('push_subscriptions')
        .update({ is_active: false })
        .eq('endpoint', endpoint)
        .eq('user_id', userId);
    }

    return { success: true };
  } catch (err: unknown) {
    console.error('[WebPush] Unsubscribe error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to unsubscribe'
    };
  }
}

/**
 * Retrieves the active push subscription record for the current browser, if registered.
 */
export async function getActiveDeviceSubscription(
  userId: string
): Promise<PushSubscriptionRecord | null> {
  if (!isPushNotificationSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    const browserSub = await registration.pushManager.getSubscription();

    if (!browserSub) return null;

    const { data } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('endpoint', browserSub.endpoint)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    return (data as PushSubscriptionRecord) || null;
  } catch {
    return null;
  }
}

/**
 * Updates notification preferences for an active subscription.
 */
export async function updateSubscriptionPreferences(
  subscriptionId: string,
  preferences: {
    attendance_reminders_enabled?: boolean;
    attendance_status_updates_enabled?: boolean;
    absence_alerts_enabled?: boolean;
  }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .update(preferences)
      .eq('id', subscriptionId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Requests the server to dispatch an authenticated test push notification
 * to the calling user's active device(s).
 */
export async function sendTestPushNotification(): Promise<{ success: boolean; message: string }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      return {
        success: false,
        message: 'You must be signed in to send a test notification.'
      };
    }

    // Call Supabase Edge Function push-notifier /send-test
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const functionUrl = `${supabaseUrl}/functions/v1/push-notifier/send-test`;

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString()
      })
    });

    if (response.ok) {
      const resJson = await response.json();
      return {
        success: true,
        message: resJson.message || 'Test push notification sent successfully!'
      };
    } else {
      // If Edge Function not deployed or returning error, try fallback status message
      const errText = await response.text();
      return {
        success: false,
        message: `Notification server returned: ${errText || response.statusText}`
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Network error sending test notification.'
    };
  }
}
