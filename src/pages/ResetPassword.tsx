import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(true);
  const [hasValidSession, setHasValidSession] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const urlInfo = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      code: params.get('code'),
      type: params.get('type'),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      setVerifying(true);
      try {
        // Modern recovery links often include a `code` that must be exchanged for a session.
        if (urlInfo.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const ok = Boolean(data.session);
        if (!cancelled) {
          setHasValidSession(ok);
          if (ok) toast.success('Reset link verified. Set a new password.');
          else toast.error('This reset link is invalid or expired. Please request a new one.');
        }
      } catch (e: any) {
        if (!cancelled) {
          setHasValidSession(false);
          toast.error(e?.message ?? 'Unable to verify reset link. Please request a new one.');
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    };

    verify();

    return () => {
      cancelled = true;
    };
  }, [urlInfo.code]);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Password updated!');
      navigate('/settings', { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(var(--background))] to-[hsl(var(--secondary)/0.3)] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Reset Password</CardTitle>
          <CardDescription>
            {urlInfo.type === 'recovery' ? 'Create a new password for your account.' : 'Verify your reset link.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {verifying ? (
            <div className="text-sm text-muted-foreground">Verifying reset link…</div>
          ) : hasValidSession ? (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                This link can expire or be used only once. Please request a new reset email.
              </div>
              <Button asChild className="w-full" variant="secondary">
                <Link to="/auth">Back to login</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
