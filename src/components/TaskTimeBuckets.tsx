import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type TimeBucket = 'today' | 'week' | 'later' | 'all';

interface TaskTimeBucketsProps {
  value: TimeBucket;
  onChange: (value: TimeBucket) => void;
  counts: {
    today: number;
    week: number;
    later: number;
    all: number;
  };
}

export default function TaskTimeBuckets({ value, onChange, counts }: TaskTimeBucketsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as TimeBucket)} className="w-full">
      <TabsList className="grid w-full grid-cols-4 bg-secondary/50">
        <TabsTrigger value="today" className="text-xs data-[state=active]:bg-white">
          Today {counts.today > 0 && <span className="ml-1 text-muted-foreground">({counts.today})</span>}
        </TabsTrigger>
        <TabsTrigger value="week" className="text-xs data-[state=active]:bg-white">
          This Week {counts.week > 0 && <span className="ml-1 text-muted-foreground">({counts.week})</span>}
        </TabsTrigger>
        <TabsTrigger value="later" className="text-xs data-[state=active]:bg-white">
          Later {counts.later > 0 && <span className="ml-1 text-muted-foreground">({counts.later})</span>}
        </TabsTrigger>
        <TabsTrigger value="all" className="text-xs data-[state=active]:bg-white">
          All {counts.all > 0 && <span className="ml-1 text-muted-foreground">({counts.all})</span>}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}