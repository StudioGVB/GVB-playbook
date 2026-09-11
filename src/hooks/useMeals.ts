import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type MealCategory = 'base' | 'meat' | 'side';

export type MealIngredient = {
  id: string;
  user_id: string;
  category: MealCategory;
  name: string;
  pack_price: number;
  pack_currency: string;
  servings_per_pack: number;
  calories_per_serving: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MealCombo = {
  id: string;
  user_id: string;
  name: string;
  base_id: string | null;
  meat_id: string | null;
  side_id: string | null;
  side2_id: string | null;
  created_at: string;
  updated_at: string;
};

const SEED: Array<Omit<MealIngredient, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'notes'>> = [
  // Bases
  { category: 'base', name: 'Basmati Rice',    pack_price: 2.50, pack_currency: 'GBP', servings_per_pack: 10, calories_per_serving: 205 },
  { category: 'base', name: 'Spaghetti',       pack_price: 1.20, pack_currency: 'GBP', servings_per_pack: 8,  calories_per_serving: 220 },
  { category: 'base', name: 'Potatoes',        pack_price: 1.80, pack_currency: 'GBP', servings_per_pack: 6,  calories_per_serving: 180 },
  { category: 'base', name: 'Couscous',        pack_price: 1.50, pack_currency: 'GBP', servings_per_pack: 5,  calories_per_serving: 190 },
  { category: 'base', name: 'Wraps',           pack_price: 1.30, pack_currency: 'GBP', servings_per_pack: 6,  calories_per_serving: 160 },
  { category: 'base', name: 'Noodles',         pack_price: 1.00, pack_currency: 'GBP', servings_per_pack: 4,  calories_per_serving: 210 },
  // Meats
  { category: 'meat', name: 'Chicken Breast',  pack_price: 6.00, pack_currency: 'GBP', servings_per_pack: 4,  calories_per_serving: 250 },
  { category: 'meat', name: 'Beef Mince',      pack_price: 4.50, pack_currency: 'GBP', servings_per_pack: 4,  calories_per_serving: 300 },
  { category: 'meat', name: 'Salmon Fillet',   pack_price: 5.00, pack_currency: 'GBP', servings_per_pack: 2,  calories_per_serving: 280 },
  { category: 'meat', name: 'Eggs',            pack_price: 2.20, pack_currency: 'GBP', servings_per_pack: 6,  calories_per_serving: 155 },
  { category: 'meat', name: 'Tofu',            pack_price: 1.80, pack_currency: 'GBP', servings_per_pack: 3,  calories_per_serving: 145 },
  { category: 'meat', name: 'Sausages',        pack_price: 3.00, pack_currency: 'GBP', servings_per_pack: 4,  calories_per_serving: 270 },
  // Sides
  { category: 'side', name: 'Broccoli',        pack_price: 0.80, pack_currency: 'GBP', servings_per_pack: 3,  calories_per_serving: 55 },
  { category: 'side', name: 'Mixed Salad',     pack_price: 1.00, pack_currency: 'GBP', servings_per_pack: 2,  calories_per_serving: 40 },
  { category: 'side', name: 'Roast Veg',       pack_price: 1.50, pack_currency: 'GBP', servings_per_pack: 3,  calories_per_serving: 120 },
  { category: 'side', name: 'Beans',           pack_price: 0.60, pack_currency: 'GBP', servings_per_pack: 2,  calories_per_serving: 130 },
  { category: 'side', name: 'Corn',            pack_price: 0.90, pack_currency: 'GBP', servings_per_pack: 3,  calories_per_serving: 90 },
  { category: 'side', name: 'Greek Salad',     pack_price: 2.20, pack_currency: 'GBP', servings_per_pack: 2,  calories_per_serving: 180 },
];

export function useMeals() {
  const { user } = useAuth();
  const [ingredients, setIngredients] = useState<MealIngredient[]>([]);
  const [combos, setCombos] = useState<MealCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const seedingRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    const [ing, com] = await Promise.all([
      supabase.from('meal_ingredients' as any).select('*').order('name'),
      supabase.from('meal_combos' as any).select('*').order('created_at', { ascending: false }),
    ]);
    if (ing.data) setIngredients(ing.data as any);
    if (com.data) setCombos(com.data as any);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Seed on first-ever load
  useEffect(() => {
    if (!user || loading || seedingRef.current) return;
    if (ingredients.length > 0) return;
    seedingRef.current = true;
    (async () => {
      const rows = SEED.map(s => ({ ...s, user_id: user.id }));
      const { error } = await supabase.from('meal_ingredients' as any).insert(rows);
      if (!error) await fetchAll();
      seedingRef.current = false;
    })();
  }, [user, loading, ingredients.length, fetchAll]);

  const addIngredient = async (input: Partial<MealIngredient> & { category: MealCategory; name: string }) => {
    if (!user) return;
    const row = {
      user_id: user.id,
      category: input.category,
      name: input.name,
      pack_price: input.pack_price ?? 0,
      pack_currency: input.pack_currency ?? 'GBP',
      servings_per_pack: input.servings_per_pack ?? 1,
      calories_per_serving: input.calories_per_serving ?? 0,
      notes: input.notes ?? null,
    };
    const { error } = await supabase.from('meal_ingredients' as any).insert(row);
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${input.name}`);
    fetchAll();
  };

  const updateIngredient = async (id: string, updates: Partial<MealIngredient>) => {
    const { error } = await supabase.from('meal_ingredients' as any).update(updates as any).eq('id', id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  };

  const deleteIngredient = async (id: string) => {
    const { error } = await supabase.from('meal_ingredients' as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Deleted');
    fetchAll();
  };

  const saveCombo = async (input: { name: string; base_id: string | null; meat_id: string | null; side_id: string | null; side2_id?: string | null }) => {
    if (!user) return;
    const { error } = await supabase.from('meal_combos' as any).insert({ ...input, user_id: user.id });
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved: ${input.name}`);
    fetchAll();
  };

  const deleteCombo = async (id: string) => {
    const { error } = await supabase.from('meal_combos' as any).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    fetchAll();
  };

  return { ingredients, combos, loading, addIngredient, updateIngredient, deleteIngredient, saveCombo, deleteCombo, refetch: fetchAll };
}

export function costPerServing(i?: MealIngredient | null): number {
  if (!i) return 0;
  const s = i.servings_per_pack || 1;
  return i.pack_price / s;
}
