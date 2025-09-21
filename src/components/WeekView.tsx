import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  calendarId: string;
  description?: string;
}

interface WeekViewProps {
  currentDate: Date;
  selectedCalendars: string[];
  events: CalendarEvent[];
  onDateChange: (date: Date) => void;
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

export function WeekView({
  currentDate,
  selectedCalendars,
  events,
  onDateChange,
  onDayClick,
  onEventClick
}: WeekViewProps) {
  const startOfWeek = new Date(currentDate);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    return date;
  });

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
    onDateChange(newDate);
  };

  const getDayEvents = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.toDateString() === date.toDateString() && 
             selectedCalendars.includes(event.calendarId);
    });
  };

  const today = new Date();
  const weekTitle = `${weekDays[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${weekDays[6].toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{weekTitle}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateWeek('prev')}
            className="hover-lift"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => onDateChange(new Date())}
            className="hover-lift"
          >
            This Week
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateWeek('next')}
            className="hover-lift"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 gap-0">
          {weekDays.map((date, index) => {
            const dayEvents = getDayEvents(date);
            const isToday = today.toDateString() === date.toDateString();
            
            return (
              <div
                key={index}
                className={`border-r border-b border-border/50 min-h-[200px] p-2 cursor-pointer hover:bg-muted/50 transition-colors ${
                  isToday ? 'bg-accent/5' : ''
                } ${index === 6 ? 'border-r-0' : ''}`}
                onClick={() => onDayClick(date)}
              >
                <div className="mb-2">
                  <div className="text-xs text-muted-foreground">
                    {date.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-lg font-medium ${isToday ? 'text-accent' : ''}`}>
                    {date.getDate()}
                  </div>
                </div>
                
                <div className="space-y-1">
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      className="calendar-event hover-lift cursor-pointer text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(event);
                      }}
                    >
                      <div className="font-medium">{event.title}</div>
                      {event.time && (
                        <div className="text-xs opacity-75">{event.time}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}