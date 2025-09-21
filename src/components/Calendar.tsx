import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EventModal } from './EventModal';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  calendarId: string;
  description?: string;
}

interface CalendarProps {
  selectedCalendars: string[];
  events: CalendarEvent[];
  onEventCreate: (event: Omit<CalendarEvent, 'id'>) => void;
  onEventEdit: (event: CalendarEvent) => void;
  onEventDelete: (eventId: string) => void;
}

export function Calendar({ selectedCalendars, events, onEventCreate, onEventEdit, onEventDelete }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const today = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const firstDayWeekday = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + (direction === 'next' ? 1 : -1));
      return newDate;
    });
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
    setSelectedDate(clickedDate);
    setEditingEvent(null);
    setIsEventModalOpen(true);
  };

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingEvent(event);
    setIsEventModalOpen(true);
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
            {dayEvents.slice(0, 3).map(event => (
              <div
                key={event.id}
                className="calendar-event hover-lift cursor-pointer"
                onClick={(e) => handleEventClick(event, e)}
              >
                {event.title}
              </div>
            ))}
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
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
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
            onClick={() => setCurrentDate(new Date())}
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
          <Button
            className="ml-4 hover-lift"
            onClick={() => {
              setSelectedDate(new Date());
              setEditingEvent(null);
              setIsEventModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Event
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

      <EventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        selectedDate={selectedDate}
        editingEvent={editingEvent}
        onEventSave={editingEvent ? onEventEdit : onEventCreate}
        onEventDelete={onEventDelete}
      />
    </div>
  );
}