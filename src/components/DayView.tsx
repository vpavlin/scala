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

interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
}

interface DayViewProps {
  currentDate: Date;
  selectedCalendars: string[];
  events: CalendarEvent[];
  calendars: CalendarData[];
  onDateChange: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onTimeSlotClick: (date: Date, time: string) => void;
}

export function DayView({
  currentDate,
  selectedCalendars,
  events,
  calendars,
  onDateChange,
  onEventClick,
  onTimeSlotClick
}: DayViewProps) {
  const navigateDay = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + (direction === 'next' ? 1 : -1));
    onDateChange(newDate);
  };

  const getDayEvents = () => {
    return events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.toDateString() === currentDate.toDateString() && 
             selectedCalendars.includes(event.calendarId);
    }).sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time.localeCompare(b.time);
    });
  };

  const hours = Array.from({ length: 24 }, (_, i) => {
    const hour = i.toString().padStart(2, '0');
    return `${hour}:00`;
  });

  const today = new Date();
  const isToday = today.toDateString() === currentDate.toDateString();
  
  // Ensure currentDate is a proper Date object
  const dateObj = currentDate instanceof Date ? currentDate : new Date(currentDate);
  const dayTitle = dateObj.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const dayEvents = getDayEvents();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{dayTitle}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateDay('prev')}
            className="hover-lift"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => onDateChange(new Date())}
            className="hover-lift"
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateDay('next')}
            className="hover-lift"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* All Day Events */}
        <Card className="p-3 sm:p-4 lg:col-span-3">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">All Day Events</h3>
          <div className="space-y-2">
            {dayEvents.filter(event => !event.time).map(event => {
              const calendar = calendars.find(cal => cal.id === event.calendarId);
              const calendarColor = calendar?.color || '#10b981';
              
              return (
                <div
                  key={event.id}
                  className="calendar-event hover-lift cursor-pointer p-2"
                  style={{
                    backgroundColor: `${calendarColor}15`,
                    color: calendarColor,
                    borderColor: `${calendarColor}40`
                  }}
                  onClick={() => onEventClick(event)}
                  title={event.title}
                >
                  <span className="truncate block">{event.title}</span>
                </div>
              );
            })}
            {dayEvents.filter(event => !event.time).length === 0 && (
              <div className="text-sm text-muted-foreground italic">No all-day events</div>
            )}
          </div>
        </Card>

        {/* Time Grid */}
        <Card className="lg:col-span-2 max-h-[400px] sm:max-h-[600px] overflow-y-auto">
          <div className="p-3 sm:p-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Schedule</h3>
            <div className="space-y-0">
              {hours.map(hour => {
                const hourEvents = dayEvents.filter(event => 
                  event.time && event.time.startsWith(hour.split(':')[0])
                );
                
                return (
                  <div
                    key={hour}
                    className="flex border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => onTimeSlotClick(currentDate, hour)}
                  >
                    <div className="w-12 sm:w-16 p-1 sm:p-2 text-xs text-muted-foreground border-r border-border/50">
                      <span className="sm:hidden">{hour.split(':')[0]}</span>
                      <span className="hidden sm:inline">{hour}</span>
                    </div>
                    <div className="flex-1 p-1 sm:p-2 min-h-[40px] sm:min-h-[50px]">
                      <div className="space-y-1">
                        {hourEvents.map(event => {
                          const calendar = calendars.find(cal => cal.id === event.calendarId);
                          const calendarColor = calendar?.color || '#10b981';
                          
                          return (
                            <div
                              key={event.id}
                              className="calendar-event hover-lift cursor-pointer text-xs"
                              style={{
                                backgroundColor: `${calendarColor}15`,
                                color: calendarColor,
                                borderColor: `${calendarColor}40`
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onEventClick(event);
                              }}
                              title={event.title}
                            >
                              <div className="font-medium truncate">{event.title}</div>
                              <div className="opacity-75">{event.time}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Events Summary */}
        <Card className="p-3 sm:p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Events Today ({dayEvents.length})
          </h3>
          <div className="space-y-2">
            {dayEvents.map(event => (
              <div
                key={event.id}
                className="p-2 rounded-md border border-border/50 hover:bg-muted/50 cursor-pointer hover-lift transition-colors"
                onClick={() => onEventClick(event)}
                title={event.title}
              >
                <div className="text-sm font-medium truncate">{event.title}</div>
                <div className="text-xs text-muted-foreground">
                  {event.time || 'All day'}
                </div>
              </div>
            ))}
            {dayEvents.length === 0 && (
              <div className="text-sm text-muted-foreground italic">No events today</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}