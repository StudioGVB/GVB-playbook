import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Shuffle, Save, Trash2, Plus, Utensils, Beef, Salad, X, Star, Pencil, Sparkles, Loader2 } from 'lucide-react';
import { useMeals, costPerServing, type MealCategory, type MealIngredient } from '@/hooks/useMeals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type CatConfig = {
  key: MealCategory;
  label: string;
  icon: any;
};

const CATS: CatConfig[] = [
  { key: 'base', label: 'Base', icon: Utensils },
  { key: 'meat', label: 'Meat', icon: Beef },
  { key: 'side', label: 'Side', icon: Salad },
];


const money = (n: number) => `£${n.toFixed(2)}`;

function IngredientCard({ item, cat, onFlip, count, index }: {
  item: MealIngredient | null;
  cat: CatConfig;
  onFlip: (dir: -1 | 1) => void;
  count: number;
  index: number;
}) {
  const Icon = cat.icon;
  const cost = costPerServing(item);
  return (
    <Card className="p-5 flex flex-col min-h-[280px] overflow-hidden border bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-primary">
            <Icon className="w-5 h-5" strokeWidth={2.4} />
          </div>
          <span className="font-display font-bold uppercase tracking-widest text-xs text-card-foreground">
            {cat.label}
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
          {count > 0 ? `${index + 1} / ${count}` : '0 / 0'}
        </span>
      </div>

      <div key={item?.id || 'empty'} className="flex-1 flex flex-col justify-center animate-fade-in">
        {item ? (
          <>
            <h3 className="font-display font-black text-2xl leading-tight text-card-foreground">
              {item.name}
            </h3>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="bg-muted/60 rounded-xl px-2 py-2 text-center">
                <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Per serve</p>
                <p className="font-display font-black text-sm tabular-nums text-card-foreground">{money(cost)}</p>
              </div>
              <div className="bg-muted/60 rounded-xl px-2 py-2 text-center">
                <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Cals</p>
                <p className="font-display font-black text-sm tabular-nums text-card-foreground">{item.calories_per_serving}</p>
              </div>
              <div className="bg-muted/60 rounded-xl px-2 py-2 text-center">
                <p className="text-[9px] uppercase font-bold tracking-wider text-muted-foreground">Pack</p>
                <p className="font-display font-black text-sm tabular-nums text-card-foreground">{money(item.pack_price)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-center text-muted-foreground">
              {item.servings_per_pack} servings / pack
            </p>
          </>
        ) : (
          <p className="text-center font-display font-bold text-muted-foreground">
            No {cat.label.toLowerCase()}s yet — add some in Manage.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          onClick={() => onFlip(-1)}
          disabled={count < 2}
          className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center disabled:opacity-30 hover:scale-105 active:scale-95 transition-transform text-card-foreground"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Button
          onClick={() => onFlip(1)}
          disabled={count < 2}
          className="flex-1 h-11 rounded-2xl font-display font-bold text-sm"
        >
          Flip →
        </Button>
        <button
          onClick={() => onFlip(1)}
          disabled={count < 2}
          className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center disabled:opacity-30 hover:scale-105 active:scale-95 transition-transform text-card-foreground"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </Card>
  );
}


function IngredientEditor({ initial, onSave, onCancel }: {
  initial?: Partial<MealIngredient> & { category: MealCategory };
  onSave: (v: any) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState<MealCategory>(initial?.category || 'base');
  const [price, setPrice] = useState(String(initial?.pack_price ?? 0));
  const [servings, setServings] = useState(String(initial?.servings_per_pack ?? 1));
  const [calories, setCalories] = useState(String(initial?.calories_per_serving ?? 0));
  const [estimating, setEstimating] = useState(false);

  const runEstimate = async () => {
    if (!name.trim()) {
      toast.error('Enter a name first');
      return;
    }
    setEstimating(true);
    try {
      const { data, error } = await supabase.functions.invoke('estimate-ingredient', {
        body: { name: name.trim(), category },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (typeof data?.pack_price === 'number') setPrice(String(data.pack_price));
      if (typeof data?.servings_per_pack === 'number') setServings(String(data.servings_per_pack));
      if (typeof data?.calories_per_serving === 'number') setCalories(String(data.calories_per_serving));
      toast.success('AI estimate applied');
    } catch (e: any) {
      toast.error(e.message || 'Estimate failed');
    } finally {
      setEstimating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {CATS.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`rounded-xl border px-3 py-2 text-xs font-display font-bold transition-all ${
              category === c.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div>
        <Label>Name</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Basmati Rice" className="flex-1" />
          <Button
            type="button"
            variant="outline"
            onClick={runEstimate}
            disabled={estimating || !name.trim()}
            className="gap-1.5 shrink-0"
          >
            {estimating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Estimate
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Pack £</Label>
          <Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} />
        </div>
        <div>
          <Label>Servings</Label>
          <Input type="number" step="0.5" value={servings} onChange={e => setServings(e.target.value)} />
        </div>
        <div>
          <Label>Calories</Label>
          <Input type="number" value={calories} onChange={e => setCalories(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Per-serving cost: <strong>{money((parseFloat(price) || 0) / Math.max(1, parseFloat(servings) || 1))}</strong>
      </p>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => onSave({
            name: name.trim(),
            category,
            pack_price: parseFloat(price) || 0,
            servings_per_pack: parseFloat(servings) || 1,
            calories_per_serving: parseInt(calories) || 0,
            pack_currency: 'GBP',
          })}
          disabled={!name.trim()}
        >
          Save
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function Meals() {
  const { ingredients, combos, loading, addIngredient, updateIngredient, deleteIngredient, saveCombo, deleteCombo } = useMeals();

  const grouped = useMemo(() => ({
    base: ingredients.filter(i => i.category === 'base'),
    meat: ingredients.filter(i => i.category === 'meat'),
    side: ingredients.filter(i => i.category === 'side'),
  }), [ingredients]);

  const [idx, setIdx] = useState<Record<MealCategory, number>>({ base: 0, meat: 0, side: 0 });
  const [side2Enabled, setSide2Enabled] = useState(false);
  const [side2Idx, setSide2Idx] = useState(1);
  const [saveOpen, setSaveOpen] = useState(false);
  const [comboName, setComboName] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MealIngredient | null>(null);

  const currentIdx = (cat: MealCategory) => {
    const arr = grouped[cat];
    if (arr.length === 0) return 0;
    return ((idx[cat] % arr.length) + arr.length) % arr.length;
  };
  const currentSide2Idx = () => {
    const arr = grouped.side;
    if (arr.length === 0) return 0;
    return ((side2Idx % arr.length) + arr.length) % arr.length;
  };
  const flip = (cat: MealCategory, dir: -1 | 1) => {
    setIdx(prev => ({ ...prev, [cat]: prev[cat] + dir }));
  };
  const flipSide2 = (dir: -1 | 1) => setSide2Idx(prev => prev + dir);
  const shuffle = () => {
    setIdx({
      base: Math.floor(Math.random() * Math.max(1, grouped.base.length)),
      meat: Math.floor(Math.random() * Math.max(1, grouped.meat.length)),
      side: Math.floor(Math.random() * Math.max(1, grouped.side.length)),
    });
    if (side2Enabled) setSide2Idx(Math.floor(Math.random() * Math.max(1, grouped.side.length)));
  };

  const current = {
    base: grouped.base[currentIdx('base')] || null,
    meat: grouped.meat[currentIdx('meat')] || null,
    side: grouped.side[currentIdx('side')] || null,
    side2: side2Enabled ? (grouped.side[currentSide2Idx()] || null) : null,
  };
  const selectedIngredients = [current.base, current.meat, current.side, current.side2].filter(Boolean) as MealIngredient[];
  const totalCost = selectedIngredients.reduce((sum, i) => sum + costPerServing(i), 0);
  const totalCals = selectedIngredients.reduce((sum, i) => sum + (i.calories_per_serving || 0), 0);
  const totalPackCost = selectedIngredients.reduce((sum, i) => sum + (i.pack_price || 0), 0);
  const totalServings = selectedIngredients.length ? Math.min(...selectedIngredients.map(i => i.servings_per_pack || 0)) : 0;



  const loadCombo = (c: typeof combos[number]) => {
    const findIdx = (cat: MealCategory, id: string | null) => {
      if (!id) return 0;
      const i = grouped[cat].findIndex(x => x.id === id);
      return i < 0 ? 0 : i;
    };
    setIdx({
      base: findIdx('base', c.base_id),
      meat: findIdx('meat', c.meat_id),
      side: findIdx('side', c.side_id),
    });
    if (c.side2_id) {
      setSide2Enabled(true);
      setSide2Idx(findIdx('side', c.side2_id));
    } else {
      setSide2Enabled(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground animate-pulse p-6">Loading meals…</div>;
  }

  return (
    <div className="min-h-screen -mx-4 sm:-mx-6 -my-6 px-4 sm:px-6 py-6 bg-background font-body">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-display font-bold text-foreground tracking-tight">Meal Flipbook</h1>
            <p className="text-muted-foreground mt-1">Mix a base, a meat, and a side. See what dinner costs.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={shuffle} className="gap-2">
              <Shuffle className="w-4 h-4" /> Shuffle
            </Button>
            <Button onClick={() => {
              const autoName = [current.base?.name, current.meat?.name].filter(Boolean).join(' and ');
              setComboName(autoName);
              setSaveOpen(true);
            }} className="gap-2">
              <Star className="w-4 h-4" /> Save combo
            </Button>
          </div>
        </div>

        <Tabs defaultValue="flip" className="w-full">
          <TabsList>
            <TabsTrigger value="flip">Flip</TabsTrigger>
            <TabsTrigger value="favourites">Favourites ({combos.length})</TabsTrigger>
            <TabsTrigger value="manage">Manage ingredients</TabsTrigger>
          </TabsList>

          {/* FLIP */}
          <TabsContent value="flip" className="mt-4 space-y-5">
            {/* Total bar */}
            <Card className="p-5 rounded-3xl border bg-card shadow-[var(--finance-card-shadow)]">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground">Total for one serving</p>
                  <p className="text-4xl font-display font-black tabular-nums text-foreground">{money(totalCost)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground">Cost to buy</p>
                  <p className="text-2xl font-display font-black tabular-nums text-foreground">{money(totalPackCost)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground">Serves</p>
                  <p className="text-2xl font-display font-black tabular-nums text-primary">{totalServings || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground">Calories</p>
                  <p className="text-2xl font-display font-black tabular-nums text-foreground">{totalCals} kcal</p>
                </div>
              </div>
            </Card>


            <div className="flex justify-end">
              <Button
                variant={side2Enabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSide2Enabled(v => !v)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" /> {side2Enabled ? 'Remove 2nd side' : 'Add a 2nd side'}
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {CATS.map(cat => (
                <IngredientCard
                  key={cat.key}
                  cat={cat}
                  item={current[cat.key]}
                  count={grouped[cat.key].length}
                  index={currentIdx(cat.key)}
                  onFlip={dir => flip(cat.key, dir)}
                />
              ))}
              {side2Enabled && (
                <IngredientCard
                  cat={{ ...CATS[2], label: 'Side 2' }}
                  item={current.side2}
                  count={grouped.side.length}
                  index={currentSide2Idx()}
                  onFlip={flipSide2}
                />
              )}
            </div>

          </TabsContent>

          {/* FAVOURITES */}
          <TabsContent value="favourites" className="mt-4 space-y-3">
            {combos.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground rounded-3xl">
                No saved combos yet. Flip to a meal you like and tap "Save combo".
              </Card>
            ) : (
              combos.map(c => {
                const b = ingredients.find(i => i.id === c.base_id) || null;
                const m = ingredients.find(i => i.id === c.meat_id) || null;
                const s = ingredients.find(i => i.id === c.side_id) || null;
                const s2 = ingredients.find(i => i.id === (c as any).side2_id) || null;
                const cost = costPerServing(b) + costPerServing(m) + costPerServing(s) + costPerServing(s2);
                const cals = (b?.calories_per_serving || 0) + (m?.calories_per_serving || 0) + (s?.calories_per_serving || 0) + (s2?.calories_per_serving || 0);


                return (
                  <Card key={c.id} className="p-4 rounded-2xl flex flex-wrap items-center gap-4 bg-card">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-bold text-lg text-card-foreground">{c.name}</h3>
                      <p className="text-sm text-muted-foreground truncate">
                        {[b?.name, m?.name, s?.name, s2?.name].filter(Boolean).join(' + ') || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display font-black tabular-nums text-foreground">{money(cost)}</p>
                      <p className="text-xs text-muted-foreground">{cals} kcal</p>
                    </div>

                    <Button size="sm" variant="outline" onClick={() => loadCombo(c)}>Load</Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteCombo(c.id)} className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </Card>
                );
              })
            )}
          </TabsContent>

          {/* MANAGE */}
          <TabsContent value="manage" className="mt-4 space-y-6">
            <div className="flex justify-end">
              <Button onClick={() => { setEditing(null); setEditorOpen(true); }} className="gap-2">
                <Plus className="w-4 h-4" /> Add ingredient
              </Button>
            </div>
            {CATS.map(cat => {
              const items = grouped[cat.key];
              const Icon = cat.icon;
              return (
                <div key={cat.key}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <h3 className="font-display font-bold text-sm uppercase tracking-widest text-card-foreground">
                      {cat.label}s ({items.length})
                    </h3>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic mb-4">None yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                      {items.map(i => (
                        <Card key={i.id} className="p-3 rounded-xl flex items-center gap-3 border bg-card">

                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{i.name}</p>
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                              {money(costPerServing(i))}/serve · {i.calories_per_serving} kcal · {money(i.pack_price)}/{i.servings_per_pack}
                            </p>
                          </div>
                          <button onClick={() => { setEditing(i); setEditorOpen(true); }} className="p-1.5 rounded hover:bg-muted">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteIngredient(i.id)} className="p-1.5 rounded hover:bg-destructive/10 text-destructive">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </div>

      {/* Save combo dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this combo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {[current.base?.name, current.meat?.name, current.side?.name, current.side2?.name].filter(Boolean).join(' + ') || 'Empty combo'} · {money(totalCost)}
            </p>
            <Input
              value={comboName}
              onChange={e => setComboName(e.target.value)}
              placeholder="e.g. Chicken rice + broccoli"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!comboName.trim()) return;
                await saveCombo({
                  name: comboName.trim(),
                  base_id: current.base?.id || null,
                  meat_id: current.meat?.id || null,
                  side_id: current.side?.id || null,
                  side2_id: current.side2?.id || null,
                });
                setSaveOpen(false);
              }}
              disabled={!comboName.trim()}
            >
              <Save className="w-4 h-4 mr-1.5" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ingredient editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit ingredient' : 'Add ingredient'}</DialogTitle>
          </DialogHeader>
          <IngredientEditor
            initial={editing || { category: 'base' }}
            onCancel={() => setEditorOpen(false)}
            onSave={async v => {
              if (editing) await updateIngredient(editing.id, v);
              else await addIngredient(v);
              setEditorOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
