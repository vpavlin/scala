import { useState } from 'react';
import { Calendar } from '@/components/Calendar';
import { CalendarSidebar } from '@/components/CalendarSidebar';
import { EventDetailsPanel } from '@/components/EventDetailsPanel';

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
  shareUrl?: string;
}

export default function CalendarApp() {
  const [calendars, setCalendars] = useState<CalendarData[]>([
    {
      id: 'default',
      name: 'Personal',
      color: '#10b981',
      isVisible: true
    },
    {
      id: 'work',
      name: 'Work',
      color: '#3b82f6',
      isVisible: true
    },
    {
      id: 'family',
      name: 'Family',
      color: '#f59e0b',
      isVisible: false
    }
  ]);

  const [events, setEvents] = useState<CalendarEvent[]>([
    {
      id: '1',
      title: 'Team Meeting',
      date: new Date(), // Today
      time: '10:00',
      calendarId: 'work',
      description: 'Weekly team sync'
    },
    {
      id: '2',
      title: 'Doctor Appointment',
      date: new Date(Date.now() + 86400000), // Tomorrow
      time: '14:30',
      calendarId: 'default'
    },
    {
      id: '3',
      title: 'Birthday Party',
      date: new Date(Date.now() + 2 * 86400000), // Day after tomorrow
      calendarId: 'family',
      description: 'Sarah\'s birthday celebration'
    },
    {
      id: '4',
      title: 'All Day Conference',
      date: new Date(), // Today, no time = all day
      calendarId: 'work',
      description: 'Annual company conference'
    }
  ]);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const selectedCalendars = calendars.filter(cal => cal.isVisible).map(cal => cal.id);

  const handleCalendarToggle = (calendarId: string) => {
    setCalendars(prev => prev.map(cal => 
      cal.id === calendarId ? { ...cal, isVisible: !cal.isVisible } : cal
    ));
  };

  const handleCalendarCreate = (newCalendar: Omit<CalendarData, 'id'>) => {
    const calendar: CalendarData = {
      ...newCalendar,
      id: Date.now().toString()
    };
    setCalendars(prev => [...prev, calendar]);
  };

  const handleCalendarEdit = (updatedCalendar: CalendarData) => {
    setCalendars(prev => prev.map(cal => 
      cal.id === updatedCalendar.id ? updatedCalendar : cal
    ));
  };

  const handleCalendarDelete = (calendarId: string) => {
    setCalendars(prev => prev.filter(cal => cal.id !== calendarId));
    setEvents(prev => prev.filter(event => event.calendarId !== calendarId));
  };

  const handleCalendarShare = (calendarId: string) => {
    setCalendars(prev => prev.map(cal => 
      cal.id === calendarId ? { ...cal, isShared: true } : cal
    ));
  };

  const handleEventCreate = (eventData: Omit<CalendarEvent, 'id'>) => {
    const event: CalendarEvent = {
      ...eventData,
      id: Date.now().toString()
    };
    setEvents(prev => [...prev, event]);
  };

  const handleEventEdit = (updatedEvent: CalendarEvent) => {
    setEvents(prev => prev.map(event => 
      event.id === updatedEvent.id ? updatedEvent : event
    ));
    setSelectedEvent(null);
  };

  const handleEventDelete = (eventId: string) => {
    setEvents(prev => prev.filter(event => event.id !== eventId));
    setSelectedEvent(null);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleEventEditFromPanel = (event: CalendarEvent) => {
    // This will open the edit modal
    setSelectedEvent(null);
    // You could set up state to open the modal with this event
  };

  return (
    <div className="min-h-screen bg-background flex">
      <CalendarSidebar
        calendars={calendars}
        selectedCalendars={selectedCalendars}
        onCalendarToggle={handleCalendarToggle}
        onCalendarCreate={handleCalendarCreate}
        onCalendarEdit={handleCalendarEdit}
        onCalendarDelete={handleCalendarDelete}
        onCalendarShare={handleCalendarShare}
      />
      <Calendar
        selectedCalendars={selectedCalendars}
        events={events}
        onEventCreate={handleEventCreate}
        onEventEdit={handleEventEdit}
        onEventDelete={handleEventDelete}
        onEventClick={handleEventClick}
      />
      {selectedEvent && (
        <EventDetailsPanel
          event={selectedEvent}
          calendars={calendars}
          onClose={() => setSelectedEvent(null)}
          onEdit={handleEventEditFromPanel}
          onDelete={handleEventDelete}
        />
      )}
    </div>
  );
}