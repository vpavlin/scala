import { Button } from '@/components/ui/button';

type CalendarView = 'month' | 'week' | 'day';

interface ViewSelectorProps {
  currentView: CalendarView;
  onViewChange: (view: CalendarView) => void;
}

export function ViewSelector({ currentView, onViewChange }: ViewSelectorProps) {
  const views: { key: CalendarView; label: string }[] = [
    { key: 'month', label: 'Month' },
    { key: 'week', label: 'Week' },
    { key: 'day', label: 'Day' }
  ];

  return (
    <div className="flex rounded-lg border border-border p-1 bg-muted/30">
      {views.map((view) => (
        <Button
          key={view.key}
          variant={currentView === view.key ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onViewChange(view.key)}
          className={`px-4 ${
            currentView === view.key 
              ? 'bg-background shadow-sm' 
              : 'hover:bg-background/50'
          }`}
        >
          {view.label}
        </Button>
      ))}
    </div>
  );
}