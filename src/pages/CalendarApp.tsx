import { useState, useEffect } from 'react';
import { Calendar } from '@/components/Calendar';
import { CalendarSidebar } from '@/components/CalendarSidebar';
import { EventDetailsPanel } from '@/components/EventDetailsPanel';
import { useWakuSync } from '@/hooks/useWakuSync';
import { EventSourceAction } from '@/lib/wakuSync';
import { toast } from '@/hooks/use-toast';

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
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [sharedCalendarId, setSharedCalendarId] = useState<string | null>(null);

  // Initialize Waku sync
  const {
    isConnected: isWakuConnected,
    connectionStatus,
    isInitializing,
    error: wakuError,
    setEventHandler,
    createEvent: wakuCreateEvent,
    updateEvent: wakuUpdateEvent,
    deleteEvent: wakuDeleteEvent,
    initializeWaku,
    clearError
  } = useWakuSync();

  const selectedCalendars = calendars.filter(cal => cal.isVisible).map(cal => cal.id);

  // Handle incoming Waku events
  useEffect(() => {
    setEventHandler((action: EventSourceAction) => {
      console.log('Received Waku action:', action);
      
      switch (action.type) {
        case 'CREATE_EVENT':
          if (action.event) {
            setEvents(prev => {
              // Check if event already exists to avoid duplicates
              const exists = prev.some(e => e.id === action.event!.id);
              return exists ? prev : [...prev, action.event!];
            });
            toast({
              title: "Event synchronized",
              description: `"${action.event.title}" was added by another user.`
            });
          }
          break;
        case 'UPDATE_EVENT':
          if (action.event) {
            setEvents(prev => prev.map(e => e.id === action.eventId ? action.event! : e));
            toast({
              title: "Event updated",
              description: `"${action.event.title}" was updated by another user.`
            });
          }
          break;
        case 'DELETE_EVENT':
          setEvents(prev => prev.filter(e => e.id !== action.eventId));
          toast({
            title: "Event deleted",
            description: "An event was deleted by another user."
          });
          break;
      }
    });
  }, [setEventHandler]);

  // Show Waku errors
  useEffect(() => {
    if (wakuError) {
      toast({
        title: "Sync Error",
        description: wakuError,
        variant: "destructive"
      });
      clearError();
    }
  }, [wakuError, clearError]);

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

  const handleCalendarShare = (calendarId: string, isPrivate: boolean) => {
    setCalendars(prev => prev.map(cal => 
      cal.id === calendarId ? { ...cal, isShared: true, isPrivate } : cal
    ));
    setSharedCalendarId(calendarId);
  };

  const handleEventCreate = async (eventData: Omit<CalendarEvent, 'id'>) => {
    const event: CalendarEvent = {
      ...eventData,
      id: Date.now().toString()
    };
    
    // Add locally first
    setEvents(prev => [...prev, event]);
    
    // Sync via Waku if connected and this is a shared calendar
    if (isWakuConnected && sharedCalendarId === event.calendarId) {
      await wakuCreateEvent(event);
    }
  };

  const handleEventEdit = async (updatedEvent: CalendarEvent) => {
    // Update locally first
    setEvents(prev => prev.map(event => 
      event.id === updatedEvent.id ? updatedEvent : event
    ));
    
    // Sync via Waku if connected and this is a shared calendar
    if (isWakuConnected && sharedCalendarId === updatedEvent.calendarId) {
      await wakuUpdateEvent(updatedEvent);
    }
    
    setSelectedEvent(null);
  };

  const handleEventDelete = async (eventId: string) => {
    const eventToDelete = events.find(e => e.id === eventId);
    
    // Delete locally first
    setEvents(prev => prev.filter(event => event.id !== eventId));
    
    // Sync via Waku if connected and this is a shared calendar
    if (isWakuConnected && eventToDelete && sharedCalendarId === eventToDelete.calendarId) {
      await wakuDeleteEvent(eventId);
    }
    
    setSelectedEvent(null);
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleEventEditFromPanel = (event: CalendarEvent) => {
    // Close the details panel and open edit modal
    setSelectedEvent(null);
    setEditingEvent(event);
    setIsEditModalOpen(true);
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
        connectionStatus={connectionStatus}
        isWakuConnected={isWakuConnected}
        onInitializeWaku={initializeWaku}
      />
      <Calendar
        selectedCalendars={selectedCalendars}
        events={events}
        onEventCreate={handleEventCreate}
        onEventEdit={handleEventEdit}
        onEventDelete={handleEventDelete}
        onEventClick={handleEventClick}
        isEditModalOpen={isEditModalOpen}
        editingEvent={editingEvent}
        onEditModalClose={() => {
          setIsEditModalOpen(false);
          setEditingEvent(null);
        }}
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