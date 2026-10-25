-- ==============================================================================
-- CT GROUP OF INSTITUTIONS - Hostel Attendance & Guardian Alert System
-- Migration: 20261025000006_web_push_notifications.sql
-- Phase 2 Web Push Notifications: Multi-Device Subscriptions & Delivery Logs
-- Verified & Audited against existing CT Hostel schema
-- Non-destructive & Idempotent: Safe to run on existing production database
-- ==============================================================================

-- 1. ENSURE UPDATED_AT TRIGGER FUNCTION EXISTS
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. ENSURE CURRENT_USER_ROLE HELPER EXISTS (Non-destructive check)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_role') THEN
        CREATE OR REPLACE FUNCTION public.current_user_role()
        RETURNS public.user_role AS $fn$
            SELECT role FROM public.profiles WHERE id = auth.uid();
        $fn$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
    END IF;
END $$;

-- 3. CREATE PUSH SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'android' CHECK (device_type IN ('android', 'desktop', 'ios', 'other')),
    user_agent TEXT,
    attendance_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    attendance_status_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    absence_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_push_subscription_endpoint UNIQUE (endpoint),
    CONSTRAINT uq_push_subscription_user_endpoint UNIQUE (user_id, endpoint)
);

-- Idempotent column upgrade in case of partial previous run
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'push_subscriptions') THEN
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'android';
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS attendance_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS attendance_status_updates_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS absence_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
    END IF;
END $$;

-- 4. CREATE PUSH NOTIFICATION LOGS (Audit & Idempotency)
CREATE TABLE IF NOT EXISTS public.push_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'ATTENDANCE_REMINDER',
        'ATTENDANCE_VERIFIED',
        'LEAVE_STATUS',
        'ABSENCE_ALERT',
        'TEST_NOTIFICATION'
    )),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    event_reference TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (delivery_status IN ('QUEUED', 'SENT', 'FAILED', 'EXPIRED')),
    status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    delivered_at TIMESTAMPTZ,
    CONSTRAINT uq_push_notification_event_user UNIQUE (event_reference, user_id, notification_type)
);

-- Safe constraint upgrade if table was partially created in an earlier run
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'push_notification_logs') THEN
        ALTER TABLE public.push_notification_logs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
        ALTER TABLE public.push_notification_logs DROP CONSTRAINT IF EXISTS push_notification_logs_delivery_status_check;
        ALTER TABLE public.push_notification_logs ADD CONSTRAINT push_notification_logs_delivery_status_check 
            CHECK (delivery_status IN ('QUEUED', 'SENT', 'FAILED', 'EXPIRED'));
    END IF;
END $$;

-- 5. PERFORMANCE & LOOKUP INDEXES
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON public.push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON public.push_subscriptions(is_active);

CREATE INDEX IF NOT EXISTS idx_push_logs_user_id ON public.push_notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_push_logs_event_ref ON public.push_notification_logs(event_reference);
CREATE INDEX IF NOT EXISTS idx_push_logs_created_at ON public.push_notification_logs(created_at DESC);

-- 6. UPDATED_AT TRIGGER
DROP TRIGGER IF EXISTS handle_updated_at_push_subscriptions ON public.push_subscriptions;
CREATE TRIGGER handle_updated_at_push_subscriptions
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- 7. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_logs ENABLE ROW LEVEL SECURITY;

-- 8. PUSH SUBSCRIPTIONS RLS POLICIES
-- Users can query ONLY their own push subscriptions; Administrators can audit all
DROP POLICY IF EXISTS "Users can view own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can view own push subscriptions"
ON public.push_subscriptions FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
    OR public.current_user_role() = 'admin'
);

-- Users can register ONLY their own device subscriptions
DROP POLICY IF EXISTS "Users can insert own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can insert own push subscriptions"
ON public.push_subscriptions FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id
);

-- Users can update ONLY their own subscriptions (e.g. toggle preferences or disable)
DROP POLICY IF EXISTS "Users can update own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update own push subscriptions"
ON public.push_subscriptions FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id
    OR public.current_user_role() = 'admin'
)
WITH CHECK (
    auth.uid() = user_id
    OR public.current_user_role() = 'admin'
);

-- Users can delete ONLY their own device subscriptions
DROP POLICY IF EXISTS "Users can delete own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete own push subscriptions"
ON public.push_subscriptions FOR DELETE
TO authenticated
USING (
    auth.uid() = user_id
    OR public.current_user_role() = 'admin'
);

-- 9. PUSH NOTIFICATION LOGS RLS POLICIES
-- Users can view ONLY their own notification logs; Staff can review operational logs
DROP POLICY IF EXISTS "Users can view own push notification logs" ON public.push_notification_logs;
CREATE POLICY "Users can view own push notification logs"
ON public.push_notification_logs FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
    OR public.current_user_role() IN ('admin', 'warden')
);

-- SECURE INSERT POLICY: ONLY staff or trusted server-side functions can write delivery logs.
-- Ordinary authenticated users CANNOT insert or forge delivery receipts.
DROP POLICY IF EXISTS "Staff can insert push notification logs" ON public.push_notification_logs;
DROP POLICY IF EXISTS "Only staff and server can insert push logs" ON public.push_notification_logs;
CREATE POLICY "Only staff and server can insert push logs"
ON public.push_notification_logs FOR INSERT
TO authenticated
WITH CHECK (
    public.current_user_role() IN ('admin', 'warden')
);

-- 10. TABLE PERMISSIONS & ROLE GRANTS
GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT ALL ON TABLE public.push_notification_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.push_notification_logs TO authenticated;
REVOKE ALL ON TABLE public.push_subscriptions FROM anon;
REVOKE ALL ON TABLE public.push_notification_logs FROM anon;
