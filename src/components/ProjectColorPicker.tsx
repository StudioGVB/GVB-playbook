import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ProjectColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

// Preset colors for quick selection
const PRESET_COLORS = [
  '#4558ff', // Blue
  '#da60ff', // Purple
  '#24af58', // Green
  '#ffaded', // Pink
  '#ffb92c', // Orange
  '#6b7280', // Slate
  '#ef4444', // Red
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#f97316', // Orange bright
  '#8b5cf6', // Violet
  '#ec4899', // Pink bright
];

// Convert hex to HSL string for CSS variable format
function hexToHSL(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '220 50% 55%';
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Convert HSL string to hex
function hslToHex(hsl: string): string {
  // Handle var() format
  if (hsl.startsWith('var(')) {
    // Return a default for preset colors
    const colorMap: Record<string, string> = {
      'var(--project-moving-abroad)': '#4558ff',
      'var(--project-pip)': '#da60ff',
      'var(--project-back-pocket-games)': '#24af58',
      'var(--project-studio-gvb)': '#ffaded',
      'var(--project-travel-app)': '#ffb92c',
      'var(--project-personal)': '#6b7280',
    };
    return colorMap[hsl] || '#6b7280';
  }
  
  const parts = hsl.split(' ');
  if (parts.length < 3) return '#6b7280';
  
  const h = parseInt(parts[0]) / 360;
  const s = parseInt(parts[1]) / 100;
  const l = parseInt(parts[2]) / 100;
  
  let r, g, b;
  
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Check if value is a preset project color class
function isPresetColorClass(value: string): boolean {
  return value.startsWith('project-');
}

// Get display color from value (either class or custom HSL)
function getDisplayColor(value: string): string {
  if (isPresetColorClass(value)) {
    const colorMap: Record<string, string> = {
      'project-moving-abroad': '#4558ff',
      'project-pip': '#da60ff',
      'project-back-pocket-games': '#24af58',
      'project-studio-gvb': '#ffaded',
      'project-travel-app': '#ffb92c',
      'project-personal': '#6b7280',
    };
    return colorMap[value] || '#6b7280';
  }
  // Assume it's an HSL string
  return hslToHex(value);
}

export default function ProjectColorPicker({ value, onChange }: ProjectColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(getDisplayColor(value));
  const colorInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    setHexInput(getDisplayColor(value));
  }, [value]);
  
  const handlePresetClick = (hex: string) => {
    setHexInput(hex);
    onChange(hexToHSL(hex));
  };
  
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    setHexInput(hex);
    onChange(hexToHSL(hex));
  };
  
  const handleHexInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let hex = e.target.value;
    setHexInput(hex);
    
    // Only update if valid hex
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hexToHSL(hex));
    }
  };
  
  const displayColor = getDisplayColor(value);
  
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Project Color</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start gap-3 h-12"
          >
            <div 
              className="w-8 h-8 rounded-full border-2 border-border shadow-sm"
              style={{ backgroundColor: displayColor }}
            />
            <span className="text-muted-foreground">{hexInput.toUpperCase()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4" align="start">
          <div className="space-y-4">
            {/* Color picker input */}
            <div className="relative">
              <input
                ref={colorInputRef}
                type="color"
                value={hexInput}
                onChange={handleColorChange}
                className="w-full h-32 cursor-pointer rounded-lg border-0"
                style={{ padding: 0 }}
              />
            </div>
            
            {/* Preset colors */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Presets</p>
              <div className="grid grid-cols-6 gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => handlePresetClick(color)}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all border-2 hover:scale-110",
                      hexInput.toLowerCase() === color.toLowerCase() 
                        ? "border-foreground ring-2 ring-foreground/20" 
                        : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            
            {/* Hex input */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Hex Color</p>
              <Input
                value={hexInput}
                onChange={handleHexInputChange}
                placeholder="#4558ff"
                className="font-mono"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
