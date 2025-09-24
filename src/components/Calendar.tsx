import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventModal } from './EventModal';
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
  isEditModalOpen?: boolean;
  editingEvent?: CalendarEvent | null;
  onEditModalClose?: () => void;
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
  isEditModalOpen = false,
  editingEvent = null,
  onEditModalClose,
  onSidebarToggle,
  isSidebarOpen = false
}: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<CalendarView>('month');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [modalEditingEvent, setModalEditingEvent] = useState<CalendarEvent | null>(null);

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setModalEditingEvent(null);
    setIsEventModalOpen(true);
  };

  const handleTimeSlotClick = (date: Date, time: string) => {
    setSelectedDate(date);
    setModalEditingEvent(null);
    // Pre-fill time when creating event from time slot
    setIsEventModalOpen(true);
  };

  const handleEventModalClick = (event: CalendarEvent) => {
    setModalEditingEvent(event);
    setSelectedDate(new Date(event.date));
    setIsEventModalOpen(true);
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
            setSelectedDate(new Date());
            setModalEditingEvent(null);
            setIsEventModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">New Event</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {renderCurrentView()}

      <EventModal
        isOpen={isEventModalOpen || isEditModalOpen}
        onClose={() => {
          setIsEventModalOpen(false);
          onEditModalClose?.();
        }}
        calendars={calendars}
        selectedDate={selectedDate || (editingEvent ? new Date(editingEvent.date) : null)}
        editingEvent={modalEditingEvent || editingEvent}
        onEventSave={modalEditingEvent || editingEvent ? onEventEdit : onEventCreate}
        onEventDelete={onEventDelete}
      />
    </div>
  );
}