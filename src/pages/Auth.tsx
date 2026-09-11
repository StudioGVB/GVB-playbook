import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mail, KeyRound, ArrowLeft, Loader2 } from 'lucide-react';

export default function Auth() {
  const { user, loading, sendOtpCode, verifyOtpCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (resendCooldown > 0) {
      interval = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [resendCooldown]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(var(--background))] to-[hsl(var(--secondary)/0.3)]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter your email.');
      return;
    }
    setSubmitting(true);

    try {
      const { error } = await sendOtpCode(email.trim());
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('One-time code sent to your email!');
        setOtpSent(true);
        setResendCooldown(60);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.trim().length !== 6) {
      toast.error('Please enter the 6-digit code.');
      return;
    }
    setSubmitting(true);

    try {
      const { error } = await verifyOtpCode(email.trim(), code.trim());
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Signed in successfully!');
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setSubmitting(true);

    try {
      const { error } = await sendOtpCode(email.trim());
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('New code sent!');
        setResendCooldown(60);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to resend code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToEmail = () => {
    setOtpSent(false);
    setCode('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(var(--background))] to-[hsl(var(--secondary)/0.3)] p-4">
      <Card className="w-full max-w-md border-border/40 shadow-xl backdrop-blur-sm bg-card/95 transition-all duration-300">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-3xl font-black bg-gradient-to-r from-[hsl(var(--project-studio-gvb))] via-[hsl(var(--project-pip))] to-[hsl(var(--project-moving-abroad))] bg-clip-text text-transparent tracking-tight">
            Life Control
          </CardTitle>
          <CardDescription className="text-sm font-medium mt-1">
            {otpSent ? 'Verify your email code' : 'Sign in passwordless with email'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!otpSent ? (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 h-10 text-sm font-medium bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary"
                    required
                    disabled={submitting}
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-10 font-bold transition-all duration-200" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Sending code...
                  </>
                ) : (
                  'Send One-Time Code'
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="------"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="pl-9 h-10 text-center text-lg font-mono font-bold tracking-[0.3em] bg-muted/30 focus-visible:ring-1 focus-visible:ring-primary"
                    maxLength={6}
                    required
                    disabled={submitting}
                    autoFocus
                  />
                </div>
                <p className="text-xs text-center text-muted-foreground font-medium">
                  We sent a 6-digit verification code to <span className="font-semibold text-foreground">{email}</span>.
                </p>
              </div>
              <Button type="submit" className="w-full h-10 font-bold transition-all duration-200" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Sign In'
                )}
              </Button>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleBackToEmail}
                  className="text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  disabled={submitting}
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to email
                </button>
                <button
                  type="button"
                  onClick={handleResend}
                  className={`text-xs font-semibold transition-colors ${
                    resendCooldown > 0
                      ? 'text-muted-foreground/60 cursor-not-allowed'
                      : 'text-primary hover:underline'
                  }`}
                  disabled={submitting || resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                </button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}