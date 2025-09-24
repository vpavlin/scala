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

interface MonthViewProps {
  currentDate: Date;
  selectedCalendars: string[];
  events: CalendarEvent[];
  calendars: CalendarData[];
  onDateChange: (date: Date) => void;
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

export function MonthView({
  currentDate,
  selectedCalendars,
  events,
  calendars,
  onDateChange,
  onDayClick,
  onEventClick
}: MonthViewProps) {
  const today = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstDayWeekday = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1));
    onDateChange(newDate);
  };

  const getDayEvents = (day: number) => {
    const dayDate = new Date(year, month, day);
    return events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.toDateString() === dayDate.toDateString() && 
             selectedCalendars.includes(event.calendarId);
    });
  };

  const handleDayClick = (day: number) => {
    const clickedDate = new Date(year, month, day);
    onDayClick(clickedDate);
  };

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    onEventClick(event);
  };

  const renderCalendarDays = () => {
    const days = [];
    
    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDayWeekday; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 border-r border-b border-border/50"></div>);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = getDayEvents(day);
      const isToday = today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
      
      days.push(
        <div
          key={day}
          className={`h-24 border-r border-b border-border/50 p-1 cursor-pointer hover:bg-muted/50 transition-colors ${
            isToday ? 'bg-accent/5' : ''
          }`}
          onClick={() => handleDayClick(day)}
        >
          <div className={`text-sm font-medium mb-1 ${isToday ? 'text-accent' : 'text-foreground'}`}>
            {day}
          </div>
          <div className="space-y-1">
            {dayEvents.slice(0, 3).map(event => {
              const calendar = calendars.find(cal => cal.id === event.calendarId);
              const calendarColor = calendar?.color || '#10b981';
              
              return (
                <div
                  key={event.id}
                  className="calendar-event hover-lift cursor-pointer"
                  style={{
                    backgroundColor: `${calendarColor}15`,
                    color: calendarColor,
                    borderColor: `${calendarColor}40`
                  }}
                  onClick={(e) => handleEventClick(event, e)}
                >
                  {event.title}
                </div>
              );
            })}
            {dayEvents.length > 3 && (
              <div className="text-xs text-muted-foreground">
                +{dayEvents.length - 3} more
              </div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{monthName}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigateMonth('prev')}
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
            onClick={() => navigateMonth('next')}
            className="hover-lift"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="h-12 border-r border-b border-border/50 flex items-center justify-center bg-muted/30">
              <span className="text-sm font-medium text-muted-foreground">{day}</span>
            </div>
          ))}
          {renderCalendarDays()}
        </div>
      </Card>
    </div>
  );
}