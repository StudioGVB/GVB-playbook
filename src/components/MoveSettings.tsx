import { useState, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

export interface MoveSettingsData {
  target: string;
  stopover: string;
  stopoverDuration: string;
  departureDate: string;
  weeksRemaining: number;
  workType: string;
  budgetSensitivity: string;
}

const STORAGE_KEY = 'move-settings';

const defaultSettings: MoveSettingsData = {
  target: 'UK (Manchester)',
  stopover: 'Spain',
  stopoverDuration: '2 weeks',
  departureDate: '',
  weeksRemaining: 12,
  workType: 'freelancer + business owner',
  budgetSensitivity: 'medium',
};

export function loadMoveSettings(): MoveSettingsData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load move settings:', e);
  }
  return defaultSettings;
}

export function saveMoveSettings(settings: MoveSettingsData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save move settings:', e);
  }
}

export default function MoveSettings({ onSettingsChange }: { onSettingsChange?: (settings: MoveSettingsData) => void }) {
  const [settings, setSettings] = useState<MoveSettingsData>(loadMoveSettings);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    saveMoveSettings(settings);
    onSettingsChange?.(settings);
  }, [settings, onSettingsChange]);

  const updateSetting = <K extends keyof MoveSettingsData>(key: K, value: MoveSettingsData[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          Move Settings
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4 p-4 bg-muted/50 rounded-lg border border-border space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Target</Label>
            <Input
              value={settings.target}
              onChange={e => updateSetting('target', e.target.value)}
              placeholder="UK (Manchester)"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Stopover</Label>
            <Input
              value={settings.stopover}
              onChange={e => updateSetting('stopover', e.target.value)}
              placeholder="Spain"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Stopover Duration</Label>
            <Input
              value={settings.stopoverDuration}
              onChange={e => updateSetting('stopoverDuration', e.target.value)}
              placeholder="2 weeks"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Departure Date</Label>
            <Input
              type="date"
              value={settings.departureDate}
              onChange={e => updateSetting('departureDate', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Weeks Remaining</Label>
            <Input
              type="number"
              min={1}
              max={52}
              value={settings.weeksRemaining}
              onChange={e => updateSetting('weeksRemaining', Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Work Type</Label>
            <Input
              value={settings.workType}
              onChange={e => updateSetting('workType', e.target.value)}
              placeholder="freelancer + business owner"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Budget Sensitivity</Label>
          <Select value={settings.budgetSensitivity} onValueChange={v => updateSetting('budgetSensitivity', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low - Cost is not a concern</SelectItem>
              <SelectItem value="medium">Medium - Balance cost and convenience</SelectItem>
              <SelectItem value="high">High - Prioritize cheapest options</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
