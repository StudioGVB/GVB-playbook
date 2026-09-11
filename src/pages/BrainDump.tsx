import { useState } from 'react';
import { useAppData } from '@/hooks/useAppData';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function BrainDump() {
  const { data, addBrainDump, deleteBrainDump, loading } = useAppData();
  const [newNote, setNewNote] = useState('');

  const addNote = async () => {
    if (!newNote.trim()) return;
    await addBrainDump(newNote.trim());
    setNewNote('');
  };

  const handleDeleteNote = async (id: string) => {
    await deleteBrainDump(id);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8">Loading brain dump notes...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Brain Dump</h1>
        <p className="text-muted-foreground text-sm">Stop new ideas hijacking focus</p>
      </div>

      {/* Input */}
      <div className="metric-card">
        <Textarea
          placeholder="Dump your thoughts, ideas, random notes..."
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          className="min-h-[120px] resize-none"
        />
        <div className="flex justify-end mt-3">
          <Button onClick={addNote} disabled={!newNote.trim()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Note
          </Button>
        </div>
      </div>

      {/* Notes list */}
      <div className="space-y-3">
        {data.brainDump.length === 0 ? (
          <div className="metric-card text-center py-12">
            <p className="text-muted-foreground">
              Your parking lot is empty. Dump ideas here to keep them safe without acting on them.
            </p>
          </div>
        ) : (
          data.brainDump.map(note => (
            <div key={note.id} className="metric-card group">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {format(parseISO(note.created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={() => handleDeleteNote(note.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Count */}
      {data.brainDump.length > 0 && (
        <p className="text-center text-sm text-muted-foreground">
          {data.brainDump.length} note{data.brainDump.length !== 1 ? 's' : ''} in parking lot
        </p>
      )}
    </div>
  );
}
