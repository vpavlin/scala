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
    <div className="flex rounded-lg border bg-muted/30 p-1">
      {views.map((view) => (
        <Button
          key={view.key}
          variant={currentView === view.key ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onViewChange(view.key)}
          className={currentView === view.key ? 'bg-background shadow-sm' : ''}
        >
          {view.label}
        </Button>
      ))}
    </div>
  );
}