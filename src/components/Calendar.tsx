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

interface CalendarProps {
  selectedCalendars: string[];
  events: CalendarEvent[];
  onEventCreate: (event: Omit<CalendarEvent, 'id'>) => void;
  onEventEdit: (event: CalendarEvent) => void;
  onEventDelete: (eventId: string) => void;
  onEventClick: (event: CalendarEvent) => void;
  isEditModalOpen?: boolean;
  editingEvent?: CalendarEvent | null;
  onEditModalClose?: () => void;
}

export function Calendar({ 
  selectedCalendars, 
  events, 
  onEventCreate, 
  onEventEdit, 
  onEventDelete,
  onEventClick,
  isEditModalOpen = false,
  editingEvent = null,
  onEditModalClose
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
            onDateChange={setCurrentDate}
            onDayClick={handleDayClick}
            onEventClick={onEventClick}
          />
        );
    }
  };

  return (
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <ViewSelector 
          currentView={currentView}
          onViewChange={setCurrentView}
        />
        <Button
          className="hover-lift"
          onClick={() => {
            setSelectedDate(new Date());
            setModalEditingEvent(null);
            setIsEventModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          New Event
        </Button>
      </div>

      {renderCurrentView()}

      <EventModal
        isOpen={isEventModalOpen || isEditModalOpen}
        onClose={() => {
          setIsEventModalOpen(false);
          onEditModalClose?.();
        }}
        selectedDate={selectedDate || (editingEvent ? new Date(editingEvent.date) : null)}
        editingEvent={modalEditingEvent || editingEvent}
        onEventSave={modalEditingEvent || editingEvent ? onEventEdit : onEventCreate}
        onEventDelete={onEventDelete}
      />
    </div>
  );
}