import { useState } from 'react';
import { useAppData, getProjectById } from '@/hooks/useAppData';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const categories = [
  { id: 'move', label: 'Move' },
  { id: 'tools', label: 'Tools' },
  { id: 'life', label: 'Life' },
  { id: 'learning', label: 'Learning' },
  { id: 'travel', label: 'Travel' },
] as const;

const categoryColors: Record<string, string> = {
  move: 'bg-blue-100 text-blue-700 border-blue-200',
  tools: 'bg-purple-100 text-purple-700 border-purple-200',
  life: 'bg-green-100 text-green-700 border-green-200',
  learning: 'bg-amber-100 text-amber-700 border-amber-200',
  travel: 'bg-pink-100 text-pink-700 border-pink-200',
};

export default function Costs() {
  const { data, addCost, deleteCost, loading } = useAppData();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    amount: 0,
    type: 'ongoing' as 'ongoing' | 'one-off',
    category: 'tools' as 'move' | 'tools' | 'life' | 'learning' | 'travel',
    project_id: '',
  });

  const handleSubmit = async () => {
    if (!form.name?.trim() || !form.amount) return;

    await addCost({
      name: form.name.trim(),
      amount: form.amount,
      type: form.type,
      category: form.category,
      project_id: form.project_id || null,
    });

    setDialogOpen(false);
    setForm({ name: '', amount: 0, type: 'ongoing', category: 'tools', project_id: '' });
  };

  const ongoingCosts = data.costs.filter(c => c.type === 'ongoing');
  const oneOffCosts = data.costs.filter(c => c.type === 'one-off');

  const monthlyTotal = ongoingCosts.reduce((sum, c) => sum + c.amount, 0);
  const oneOffTotal = oneOffCosts.reduce((sum, c) => sum + c.amount, 0);

  const byCategory = categories.map(cat => ({
    ...cat,
    total: data.costs.filter(c => c.category === cat.id && c.type === 'ongoing').reduce((sum, c) => sum + c.amount, 0)
  })).filter(c => c.total > 0);

  const byProject = data.projects.map(p => ({
    ...p,
    total: data.costs.filter(c => c.project_id === p.id && c.type === 'ongoing').reduce((sum, c) => sum + c.amount, 0)
  })).filter(p => p.total > 0);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8">Loading costs...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Costs & Subscriptions</h1>
          <p className="text-muted-foreground text-sm">Financial clarity and decision support</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Cost
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Cost</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Input
                placeholder="Name (e.g., Lovable Pro)"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
              <Input
                type="number"
                placeholder="Amount (A$)"
                value={form.amount || ''}
                onChange={e => setForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
              />
              <div className="grid grid-cols-2 gap-4">
                <Select
                  value={form.type}
                  onValueChange={v => setForm(prev => ({ ...prev, type: v as 'ongoing' | 'one-off' }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ongoing">Ongoing (monthly)</SelectItem>
                    <SelectItem value="one-off">One-off</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={form.category}
                  onValueChange={v => setForm(prev => ({ ...prev, category: v as any }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select
                value={form.project_id || 'none'}
                onValueChange={v => setForm(prev => ({ ...prev, project_id: v === 'none' ? '' : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Link to project (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select project (optional)</SelectItem>
                  {data.projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${p.color_class}-solid`} />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleSubmit} className="w-full">Add Cost</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="metric-card">
          <p className="section-header">Monthly Total</p>
          <p className="text-3xl font-semibold">A${monthlyTotal.toLocaleString()}</p>
        </div>
        <div className="metric-card">
          <p className="section-header">One-off Total</p>
          <p className="text-3xl font-semibold">A${oneOffTotal.toLocaleString()}</p>
        </div>
      </div>

      {/* By Category */}
      {byCategory.length > 0 && (
        <div className="metric-card">
          <p className="section-header">By Category (Monthly)</p>
          <div className="flex flex-wrap gap-3">
            {byCategory.map(cat => (
              <div key={cat.id} className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded border ${categoryColors[cat.id]}`}>
                  {cat.label}
                </span>
                <span className="text-sm font-medium">A${cat.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By Project */}
      {byProject.length > 0 && (
        <div className="metric-card">
          <p className="section-header">By Project (Monthly)</p>
          <div className="flex flex-wrap gap-3">
            {byProject.map(p => (
              <div key={p.id} className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded border ${p.color_class}`}>
                  {p.name}
                </span>
                <span className="text-sm font-medium">A${p.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ongoing costs table */}
      {ongoingCosts.length > 0 && (
        <div>
          <p className="section-header">Ongoing Subscriptions</p>
          <div className="metric-card p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ongoingCosts.map(cost => {
                  const project = cost.project_id ? getProjectById(data.projects, cost.project_id) : undefined;
                  return (
                    <TableRow key={cost.id}>
                      <TableCell className="font-medium">{cost.name}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-1 rounded border ${categoryColors[cost.category]}`}>
                          {categories.find(c => c.id === cost.category)?.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {project ? (
                          <span className={`text-xs px-2 py-1 rounded border ${project.color_class}`}>
                            {project.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">A${cost.amount}/mo</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteCost(cost.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* One-off costs table */}
      {oneOffCosts.length > 0 && (
        <div>
          <p className="section-header">One-off Costs</p>
          <div className="metric-card p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oneOffCosts.map(cost => {
                  const project = cost.project_id ? getProjectById(data.projects, cost.project_id) : undefined;
                  return (
                    <TableRow key={cost.id}>
                      <TableCell className="font-medium">{cost.name}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-1 rounded border ${categoryColors[cost.category]}`}>
                          {categories.find(c => c.id === cost.category)?.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {project ? (
                          <span className={`text-xs px-2 py-1 rounded border ${project.color_class}`}>
                            {project.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">A${cost.amount}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteCost(cost.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {data.costs.length === 0 && (
        <div className="metric-card text-center py-12">
          <p className="text-muted-foreground">No costs tracked yet. Add your first subscription or expense.</p>
        </div>
      )}
    </div>
  );
}
