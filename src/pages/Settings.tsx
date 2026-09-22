import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { User, Lock, Mail, Users, Shield, Eye, EyeOff, Bell, Sparkles, Moon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendTestNotification,
  type NotificationPermissionState,
} from '@/lib/notifications';
import { useFinanceData } from '@/hooks/useFinanceData';
import { useFinanceAssumptions } from '@/hooks/useFinanceAssumptions';
import { useFixedExpenses } from '@/hooks/useFixedExpenses';
import { useWeeklyBoosts } from '@/hooks/useWeeklyBoosts';
import { useWeekTypes } from '@/hooks/useWeekTypes';
import { computePolicySnapshot } from '@/lib/policyEngine';
import { triggerPreview8pmNotification } from '@/lib/daily8pmNotification';

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

export default function Settings() {
  const { user } = useAuth();
  const finance = useFinanceData();
  const { assumptions } = useFinanceAssumptions();
  const { monthlyTotalInternal: fixedExpensesMonthly, monthlyTotal: fixedExpensesMonthlyAll } = useFixedExpenses();
  const { totalBoostThisWeek } = useWeeklyBoosts();
  const { weekTypeMap: wtMap } = useWeekTypes();

  const snapshot = useMemo(() => {
    if (!assumptions) return null;
    return computePolicySnapshot(
      assumptions, finance.accounts, finance.transactions,
      finance.categories, finance.goals, finance.convertToBase,
      fixedExpensesMonthly, totalBoostThisWeek, wtMap(), [], fixedExpensesMonthlyAll,
    );
  }, [assumptions, finance.accounts, finance.transactions, finance.categories, finance.goals, finance.convertToBase, fixedExpensesMonthly, fixedExpensesMonthlyAll, totalBoostThisWeek, wtMap]);

  const baseCurrency = finance.settings?.base_currency || 'GBP';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermissionState>(getNotificationPermission);
  
  // Admin state
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Check if current user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (!error && data) {
        setIsAdmin(true);
      }
    };
    
    checkAdmin();
  }, [user]);

  // Fetch users if admin
  useEffect(() => {
    const fetchUsers = async () => {
      if (!isAdmin) return;
      
      setLoadingUsers(true);
      try {
        const { data, error } = await supabase
          .from('admin_users_view')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (error) {
          console.error('Error fetching users:', error);
          toast.error('Failed to load users');
        } else {
          setAdminUsers(data || []);
        }
      } finally {
        setLoadingUsers(false);
      }
    };
    
    fetchUsers();
  }, [isAdmin]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success('Password updated successfully!');
        setNewPassword('');
        setConfirmPassword('');
      }
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground">Manage your account & credentials</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.href = '/finance/settings'} className="gap-1.5 border-[#FF7AD1]/40 text-[#FF2EB8] hover:bg-[#FFF5FA]">
          Finance & Bank Settings →
        </Button>
      </div>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="account" className="flex items-center gap-2">
            <User className="w-4 h-4" />
            Account
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Admin
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="account" className="space-y-6 mt-6">
          {/* Account Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Account
              </CardTitle>
              <CardDescription>Your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{user?.email || 'Not logged in'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Lock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Password</p>
                  <p className="font-medium text-xs text-muted-foreground italic">
                    Passwords are securely hashed and cannot be viewed
                  </p>
                </div>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[hsl(var(--project-back-pocket-games)/0.1)] border border-[hsl(var(--project-back-pocket-games)/0.3)]">
                  <Shield className="w-4 h-4 text-[hsl(var(--project-back-pocket-games))]" />
                  <div>
                    <p className="text-sm text-muted-foreground">Role</p>
                    <p className="font-medium text-[hsl(var(--project-back-pocket-games))]">Super Admin</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Change Password
              </CardTitle>
              <CardDescription>Update your password</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <div className="relative">
                    <Input
                      id="confirm-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      required
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Push Notifications Card */}
          <Card className="border-2 border-[#FF7AD1]/30 shadow-sm overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-[#FFF5FA] to-white border-b border-[#FF7AD1]/20">
              <CardTitle className="flex items-center gap-2 text-slate-900 font-display font-bold">
                <Bell className="w-5 h-5 text-[#FF2EB8]" />
                Push Notifications
              </CardTitle>
              <CardDescription>
                Receive real-time browser & system notifications for budget limits, task reminders, and goal milestones.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-2xl bg-slate-50 border border-slate-200 gap-4">
                <div>
                  <p className="font-display font-bold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
                    Notification Status:
                    <Badge className={cn(
                      "text-xs px-2.5 py-0.5 rounded-full font-bold",
                      notifPermission === 'granted' ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                      notifPermission === 'denied' ? "bg-rose-100 text-rose-800 border-rose-200" :
                      "bg-amber-100 text-amber-800 border-amber-200"
                    )}>
                      {notifPermission === 'granted' ? 'Active & Allowed ✅' :
                       notifPermission === 'denied' ? 'Blocked in Browser ❌' :
                       'Not Enabled Yet 🔔'}
                    </Badge>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {notifPermission === 'granted'
                      ? 'Your browser is configured to receive instant push alerts on this device.'
                      : notifPermission === 'denied'
                      ? 'Notifications were blocked. Click lock icon in address bar to unblock.'
                      : 'Click below to grant permission and enable push notifications on this device.'}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
                  {notifPermission !== 'granted' ? (
                    <Button
                      onClick={async () => {
                        const res = await requestNotificationPermission();
                        setNotifPermission(res);
                      }}
                      className="w-full sm:w-auto bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl px-4 py-2 text-sm shadow-md shadow-[#FF2EB8]/20 transition-all"
                    >
                      <Bell className="w-4 h-4 mr-2" />
                      Allow Push Notifications
                    </Button>
                  ) : (
                    <Button
                      onClick={sendTestNotification}
                      variant="outline"
                      className="w-full sm:w-auto border-[#FF2EB8] text-[#FF2EB8] hover:bg-[#FFF5FA] font-display font-bold rounded-xl px-4 py-2 text-sm transition-all"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Send Test Notification
                    </Button>
                  )}
                </div>
              </div>

              {/* Daily 8 PM Budget Summary Section */}
              <div className="p-4.5 rounded-2xl bg-[#FFF5FA] border-2 border-[#FF7AD1]/30 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Moon className="w-4 h-4 text-[#FF2EB8]" />
                      <h4 className="font-display font-bold text-slate-900 text-sm">
                        Daily 8:00 PM Budget Summary
                      </h4>
                      <Badge className="bg-[#FF2EB8] text-white text-[10px] font-bold">Active Daily</Badge>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Fires every evening at 8:00 PM GMT/BST telling you today's spend, this week's spend, and weekly budget status.
                    </p>
                  </div>

                  <Button
                    onClick={async () => {
                      if (notifPermission !== 'granted') {
                        const res = await requestNotificationPermission();
                        setNotifPermission(res);
                        if (res !== 'granted') return;
                      }
                      const success = await triggerPreview8pmNotification(
                        finance.transactions,
                        finance.categories,
                        snapshot,
                        baseCurrency
                      );
                      if (success) {
                        toast.success('Sent 8 PM notification preview!');
                      }
                    }}
                    className="w-full sm:w-auto bg-[#FF2EB8] hover:bg-[#e5299f] text-white font-display font-bold rounded-xl px-4 py-2 text-xs shadow-md shrink-0 transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    Preview 8 PM Update
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  All Users
                </CardTitle>
                <CardDescription>
                  View all registered users. Passwords are securely hashed and cannot be viewed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <div className="text-sm text-muted-foreground animate-pulse">Loading users...</div>
                ) : adminUsers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No users found</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Signed Up</TableHead>
                        <TableHead>Last Sign In</TableHead>
                        <TableHead>Verified</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adminUsers.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            {u.email}
                            {u.id === user?.id && (
                              <span className="ml-2 text-xs bg-[hsl(var(--project-back-pocket-games)/0.15)] text-[hsl(var(--project-back-pocket-games))] px-2 py-0.5 rounded-full">
                                You
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {format(new Date(u.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {u.last_sign_in_at 
                              ? format(new Date(u.last_sign_in_at), 'MMM d, yyyy h:mm a')
                              : 'Never'
                            }
                          </TableCell>
                          <TableCell>
                            {u.email_confirmed_at ? (
                              <span className="text-xs bg-[hsl(var(--project-back-pocket-games)/0.15)] text-[hsl(var(--project-back-pocket-games))] px-2 py-0.5 rounded-full">
                                Verified
                              </span>
                            ) : (
                              <span className="text-xs bg-[hsl(var(--project-travel-app)/0.15)] text-[hsl(var(--project-travel-app))] px-2 py-0.5 rounded-full">
                                Pending
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
