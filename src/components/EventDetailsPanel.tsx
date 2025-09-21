import { Edit2, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  calendarId: string;
  description?: string;
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
}

interface EventDetailsPanelProps {
  event: CalendarEvent | null;
  calendars: CalendarData[];
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}

export function EventDetailsPanel({
  event,
  calendars,
  onClose,
  onEdit,
  onDelete
}: EventDetailsPanelProps) {
  if (!event) return null;

  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (time: string) => {
    if (!time) return null;
    // Convert to 24h format display
    return time;
  };

  return (
    <div className="w-80 border-l border-border bg-card sidebar-transition">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Event Details</h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center space-x-2 mb-2">
            {calendar && (
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: calendar.color }}
              />
            )}
            <span className="text-sm text-muted-foreground">
              {calendar?.name || 'Unknown Calendar'}
            </span>
          </div>
          <h2 className="text-xl font-semibold mb-3">{event.title}</h2>
        </div>

        <Separator />

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-muted-foreground">Date</label>
            <p className="text-sm">{formatDate(event.date)}</p>
          </div>

          {event.time && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">Time</label>
              <p className="text-sm">{formatTime(event.time)}</p>
            </div>
          )}

          {event.description && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">Description</label>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}
        </div>

        <Separator />

        <div className="flex flex-col space-y-2">
          <Button
            variant="outline"
            onClick={() => onEdit(event)}
            className="w-full hover-lift"
          >
            <Edit2 className="h-4 w-4 mr-2" />
            Edit Event
          </Button>
          
          <Button
            variant="outline"
            onClick={() => onDelete(event.id)}
            className="w-full text-destructive hover:text-destructive hover-lift"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Event
          </Button>
        </div>
      </div>
    </div>
  );
}