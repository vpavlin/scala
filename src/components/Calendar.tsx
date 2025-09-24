import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ViewSelector } from './ViewSelector';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { MonthView } from './MonthView';

type CalendarView = 'month' | 'week' | 'day';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  allDay?: boolean;
  calendarId: string;
  description?: string;
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isShared?: boolean;
  isPrivate?: boolean;
  shareUrl?: string;
}

interface CalendarProps {
  calendars: CalendarData[];
  selectedCalendars: string[];
  events: CalendarEvent[];
  onEventCreate: (event: Omit<CalendarEvent, 'id'>) => void;
  onEventEdit: (event: CalendarEvent) => void;
  onEventDelete: (eventId: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  onNewEventRequest: (date: Date, time?: string, preferredCalendarId?: string) => void;
  onSidebarToggle?: () => void;
  isSidebarOpen?: boolean;
}

export function Calendar({ 
  calendars,
  selectedCalendars, 
  events, 
  onEventCreate, 
  onEventEdit, 
  onEventDelete,
  onEventClick,
  onNewEventRequest,
  onSidebarToggle,
  isSidebarOpen = false
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<CalendarView>('month');

  const handleDayClick = (date: Date) => {
    // Request to open modal for creating new event on this date
    // Prefer the first visible calendar for better UX
    const visibleCalendars = calendars.filter(cal => selectedCalendars.includes(cal.id));
    const preferredCalendarId = visibleCalendars.length > 0 ? visibleCalendars[0].id : undefined;
    onNewEventRequest(date, undefined, preferredCalendarId);
  };

  const handleTimeSlotClick = (date: Date, time: string) => {
    // Request to open modal for creating new event with pre-filled time
    const visibleCalendars = calendars.filter(cal => selectedCalendars.includes(cal.id));
    const preferredCalendarId = visibleCalendars.length > 0 ? visibleCalendars[0].id : undefined;
    onNewEventRequest(date, time, preferredCalendarId);
  };

  const handleDayViewSwitch = (date: Date) => {
    setCurrentDate(date);
    setCurrentView('day');
  };

  const renderCurrentView = () => {
    switch (currentView) {
      case 'week':
        return (
          <WeekView
            currentDate={currentDate}
            selectedCalendars={selectedCalendars}
            events={events}
            calendars={calendars}
            onDateChange={setCurrentDate}
            onDayClick={handleDayClick}
            onDayViewSwitch={handleDayViewSwitch}
            onEventClick={onEventClick}
          />
        );
      case 'day':
        return (
          <DayView
            currentDate={currentDate}
            selectedCalendars={selectedCalendars}
            events={events}
            calendars={calendars}
            onDateChange={setCurrentDate}
            onEventClick={onEventClick}
            onTimeSlotClick={handleTimeSlotClick}
          />
        );
      default:
        return (
          <MonthView
            currentDate={currentDate}
            selectedCalendars={selectedCalendars}
            events={events}
            calendars={calendars}
            onDateChange={setCurrentDate}
            onDayClick={handleDayClick}
            onDayViewSwitch={handleDayViewSwitch}
            onEventClick={onEventClick}
          />
        );
    }
  };

  return (
    <div className="flex-1 p-3 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {onSidebarToggle && (
            <Button
              variant="outline"
              size="icon"
              onClick={onSidebarToggle}
              className="lg:hidden"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
          )}
          <ViewSelector 
            currentView={currentView}
            onViewChange={setCurrentView}
          />
        </div>
        <Button
          className="hover-lift"
          onClick={() => {
            // Smart calendar selection for new event button
            const visibleCalendars = calendars.filter(cal => selectedCalendars.includes(cal.id));
            const preferredCalendarId = visibleCalendars.length > 0 ? visibleCalendars[0].id : undefined;
            onNewEventRequest(new Date(), undefined, preferredCalendarId);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">New Event</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {renderCurrentView()}
    </div>
  );
}