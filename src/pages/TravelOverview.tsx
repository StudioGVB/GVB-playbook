import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plane, Calendar, Plus, ArrowRight, MapPin, Sparkles } from 'lucide-react';
import { useFinanceTrips } from '@/hooks/useFinanceTrips';
import { format, differenceInDays, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';

export default function TravelOverview() {
  const navigate = useNavigate();
  const { trips, loading, createTrip, updateTrip } = useFinanceTrips();

  const [quickName, setQuickName] = useState('');
  const [quickStart, setQuickStart] = useState('');
  const [quickEnd, setQuickEnd] = useState('');
  const [quickNotes, setQuickNotes] = useState('');
  const [scratchpad, setScratchpad] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('travel-scratchpad') || '' : ''
  );

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const upcoming = useMemo(
    () =>
      trips
        .filter(t => !t.end_date || new Date(t.end_date) >= today)
        .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999')),
    [trips, today],
  );

  const active = upcoming.find(t => {
    if (!t.start_date || !t.end_date) return false;
    const s = new Date(t.start_date);
    const e = new Date(t.end_date);
    return s <= today && e >= today;
  });

  const nextTrip = upcoming.find(t => t !== active && t.start_date && new Date(t.start_date) > today);

  const handleQuickAdd = async () => {
    if (!quickName.trim()) {
      toast.error('Give your trip a name');
      return;
    }
    const trip = await createTrip(quickName.trim());
    if (trip && (quickStart || quickEnd || quickNotes)) {
      await updateTrip(trip.id, {
        start_date: quickStart || null,
        end_date: quickEnd || null,
        notes: quickNotes || null,
      }, true);
    }
    toast.success('Trip added');
    setQuickName('');
    setQuickStart('');
    setQuickEnd('');
    setQuickNotes('');
  };

  const saveScratchpad = (v: string) => {
    setScratchpad(v);
    localStorage.setItem('travel-scratchpad', v);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Travel</h1>
        <div className="text-muted-foreground animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Plane className="w-6 h-6 text-primary" /> Travel
          </h1>
          <p className="text-muted-foreground text-sm">Quick planning, upcoming trips, and scratch ideas</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/travel/trips">
            Manage trips <ArrowRight className="w-4 h-4 ml-1.5" />
          </Link>
        </Button>
      </div>

      {/* Highlight cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4" /> Currently
            </CardTitle>
          </CardHeader>
          <CardContent>
            {active ? (
              <div className="space-y-1">
                <div className="text-xl font-bold text-foreground">{active.name}</div>
                <div className="text-sm text-muted-foreground">
                  {active.start_date && format(new Date(active.start_date), 'MMM d')} –{' '}
                  {active.end_date && format(new Date(active.end_date), 'MMM d, yyyy')}
                </div>
                {active.end_date && (
                  <div className="text-xs text-primary font-medium">
                    {differenceInCalendarDays(new Date(active.end_date), today)} days left
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Not on a trip right now.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Next up
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextTrip ? (
              <div className="space-y-1">
                <div className="text-xl font-bold text-foreground">{nextTrip.name}</div>
                <div className="text-sm text-muted-foreground">
                  {nextTrip.start_date && format(new Date(nextTrip.start_date), 'MMM d, yyyy')}
                </div>
                {nextTrip.start_date && (
                  <div className="text-xs text-primary font-medium">
                    in {differenceInDays(new Date(nextTrip.start_date), today)} days
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No upcoming trips planned.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick add */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" /> Quick plan a trip
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3">
              <Label className="text-xs">Trip name</Label>
              <Input
                value={quickName}
                onChange={e => setQuickName(e.target.value)}
                placeholder="e.g. Lisbon weekend"
              />
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input type="date" value={quickStart} onChange={e => setQuickStart(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input type="date" value={quickEnd} onChange={e => setQuickEnd(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                rows={2}
                value={quickNotes}
                onChange={e => setQuickNotes(e.target.value)}
                placeholder="Rough plans, must-dos, links..."
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleQuickAdd}>
              <Plus className="w-4 h-4 mr-1.5" /> Add trip
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upcoming trips list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upcoming trips ({upcoming.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              Nothing planned yet. Add a trip above to get started.
            </div>
          ) : (
            upcoming.map(t => (
              <button
                key={t.id}
                onClick={() => navigate('/travel/trips')}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t.start_date ? format(new Date(t.start_date), 'MMM d') : 'No start'}
                    {t.end_date && ` – ${format(new Date(t.end_date), 'MMM d, yyyy')}`}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  {t.start_date && new Date(t.start_date) > today && (
                    <span className="font-medium text-primary">
                      {differenceInDays(new Date(t.start_date), today)}d
                    </span>
                  )}
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Scratchpad */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Ideas & wishlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={6}
            value={scratchpad}
            onChange={e => saveScratchpad(e.target.value)}
            placeholder="Places you want to visit, rough dates, flight leads, packing reminders..."
            className="resize-none"
          />
          <p className="text-[11px] text-muted-foreground mt-2">Saved locally to this browser.</p>
        </CardContent>
      </Card>
    </div>
  );
}
