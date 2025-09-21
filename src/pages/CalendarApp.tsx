import { useState, useEffect } from 'react';
import { Calendar } from '@/components/Calendar';
import { CalendarSidebar } from '@/components/CalendarSidebar';
import { EventDetailsPanel } from '@/components/EventDetailsPanel';
import { EventModal } from '@/components/EventModal';
import { ShareCalendarModal } from '@/components/ShareCalendarModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/toaster';
import { useWakuSync } from '@/hooks/useWakuSync';
import { useCalendarStorage } from '@/hooks/useCalendarStorage';
import { CalendarEvent, EventSourceAction } from '@/lib/wakuSync';
import { CalendarData } from '@/lib/storage';
import { isSameDay, format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

const defaultCalendars: CalendarData[] = [
  {
    id: 'default',
    name: 'Personal',
    color: '#10b981',
    isVisible: true
  }
];

interface CalendarAppProps {
  sharedCalendarId?: string;
  sharedEncryptionKey?: string;
}

export default function CalendarApp({ sharedCalendarId, sharedEncryptionKey }: CalendarAppProps = {}) {
  const storage = useCalendarStorage();
  const [calendars, setCalendars] = useState<CalendarData[]>(defaultCalendars);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Load data from storage on component mount
  useEffect(() => {
    const loadStoredData = async () => {
      if (!storage.isInitialized) return;
      
      try {
        const [storedCalendars, storedEvents] = await Promise.all([
          storage.loadCalendars(),
          storage.loadEvents()
        ]);
        
        // Use stored calendars if available, otherwise use defaults
        if (storedCalendars.length > 0) {
          setCalendars(storedCalendars);
        } else {
          // Save default calendars to storage
          for (const calendar of defaultCalendars) {
            await storage.saveCalendar(calendar);
          }
        }
        
        setEvents(storedEvents);
      } catch (error) {
        console.error('Failed to load stored data:', error);
      }
    };

    loadStoredData();
  }, [storage.isInitialized]);

  // Auto-save calendars when they change
  useEffect(() => {
    if (!storage.isInitialized || calendars.length === 0) return;
    
    const saveCalendars = async () => {
      for (const calendar of calendars) {
        await storage.saveCalendar(calendar);
      }
    };
    
    saveCalendars();
  }, [calendars, storage.isInitialized]);

  // Auto-save events when they change  
  useEffect(() => {
    if (!storage.isInitialized || events.length === 0) return;
    
    const saveEvents = async () => {
      for (const event of events) {
        await storage.saveEvent(event);
      }
    };
    
    saveEvents();
  }, [events, storage.isInitialized]);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [wakuCalendarId, setWakuCalendarId] = useState<string | null>(sharedCalendarId || null);

  // Show indication when we're in shared calendar mode
  useEffect(() => {
    if (sharedCalendarId) {
      console.log('Loading shared calendar:', sharedCalendarId);
      toast({
        title: "Joining shared calendar",
        description: "Connecting to Waku network and loading calendar data..."
      });
    }
  }, [sharedCalendarId]);

  // Initialize Waku sync - pass shared calendar parameters for auto-initialization
  const {
    isConnected: isWakuConnected,
    connectionStatus,
    isInitializing,
    error: wakuError,
    nodeStats,
    setEventHandler,
    createEvent: wakuCreateEvent,
    updateEvent: wakuUpdateEvent,
    deleteEvent: wakuDeleteEvent,
    initializeSharing,
    initializeWaku,
    getDetailedNodeInfo,
    clearError
  } = useWakuSync(sharedCalendarId, sharedEncryptionKey);

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
          if (action.eventId) {
            setEvents(prev => prev.filter(e => e.id !== action.eventId));
            toast({
              title: "Event deleted",
              description: "An event was deleted by another user."
            });
          }
          break;
        case 'SYNC_CALENDAR':
          if (action.calendar) {
            console.log('Received calendar sync:', action.calendar);
            setCalendars(prev => {
              const exists = prev.some(cal => cal.id === action.calendar!.id);
              if (exists) {
                return prev.map(cal => cal.id === action.calendar!.id ? { ...cal, ...action.calendar } : cal);
              } else {
                return [...prev, action.calendar as CalendarData];
              }
            });
            toast({
              title: "Calendar synchronized",
              description: `Calendar "${action.calendar.name}" was shared with you.`
            });
          }
          break;
        case 'SYNC_EVENTS':
          if (action.events && action.events.length > 0) {
            console.log('Received events sync:', action.events.length, 'events');
            setEvents(prev => {
              const newEvents = action.events!.filter(syncEvent => 
                !prev.some(existingEvent => existingEvent.id === syncEvent.id)
              );
              return [...prev, ...newEvents];
            });
            toast({
              title: "Events synchronized",
              description: `${action.events.length} historical events were synchronized.`
            });
          }
          break;
      }
    });
  }, [setEventHandler]);

  // Show Waku errors and connection status for shared calendars
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

  // Show connection success for shared calendars
  useEffect(() => {
    if (sharedCalendarId && isWakuConnected) {
      toast({
        title: "Connected to shared calendar",
        description: "You are now receiving live updates from this calendar."
      });
    }
  }, [sharedCalendarId, isWakuConnected]);

  const handleCalendarToggle = async (calendarId: string) => {
    const updatedCalendars = calendars.map(cal => 
      cal.id === calendarId ? { ...cal, isVisible: !cal.isVisible } : cal
    );
    setCalendars(updatedCalendars);
    
    // Save updated calendar to storage
    const updatedCalendar = updatedCalendars.find(cal => cal.id === calendarId);
    if (updatedCalendar) {
      await storage.saveCalendar(updatedCalendar);
    }
  };

  const handleCalendarCreate = async (calendarData: Omit<CalendarData, 'id'>) => {
    const newCalendar: CalendarData = {
      ...calendarData,
      id: Date.now().toString()
    };
    
    setCalendars(prev => [...prev, newCalendar]);
    await storage.saveCalendar(newCalendar);
  };

  const handleCalendarEdit = async (updatedCalendar: CalendarData) => {
    setCalendars(prev => prev.map(cal => 
      cal.id === updatedCalendar.id ? updatedCalendar : cal
    ));
    await storage.saveCalendar(updatedCalendar);
  };

  const handleCalendarUpdate = async (calendarId: string, updates: Partial<CalendarData>) => {
    const updatedCalendars = calendars.map(cal => 
      cal.id === calendarId ? { ...cal, ...updates } : cal
    );
    setCalendars(updatedCalendars);
    
    // Save updated calendar to storage
    const updatedCalendar = updatedCalendars.find(cal => cal.id === calendarId);
    if (updatedCalendar) {
      await storage.saveCalendar(updatedCalendar);
    }
  };

  const handleCalendarDelete = async (calendarId: string) => {
    setCalendars(prev => prev.filter(cal => cal.id !== calendarId));
    setEvents(prev => prev.filter(event => event.calendarId !== calendarId));
    await storage.deleteCalendar(calendarId);
  };

  const handleCalendarShare = async (calendarId: string, isPrivate: boolean) => {
    await handleCalendarUpdate(calendarId, { isShared: true, isPrivate });
    setWakuCalendarId(calendarId);
    
    // Initialize sharing with historical data
    const sharedCalendar = calendars.find(cal => cal.id === calendarId);
    if (sharedCalendar && isWakuConnected) {
      await initializeSharing(sharedCalendar, events);
      toast({
        title: "Calendar sharing enabled",
        description: `Calendar "${sharedCalendar.name}" and all events have been synchronized.`
      });
    }
  };

  const handleEventCreate = async (eventData: Omit<CalendarEvent, 'id'>) => {
    const event: CalendarEvent = {
      ...eventData,
      id: Date.now().toString()
    };
    
    // Add locally first
    setEvents(prev => [...prev, event]);
    await storage.saveEvent(event);
    
    // Sync via Waku if connected
    if (isWakuConnected) {
      await wakuCreateEvent(event);
    }
  };

  const handleEventUpdate = async (updatedEvent: CalendarEvent) => {
    // Update locally first
    setEvents(prev => prev.map(event => 
      event.id === updatedEvent.id ? updatedEvent : event
    ));
    await storage.saveEvent(updatedEvent);
    
    // Sync via Waku if connected
    if (isWakuConnected) {
      await wakuUpdateEvent(updatedEvent);
    }
  };

  const handleEventDelete = async (eventId: string) => {
    // Delete locally first
    setEvents(prev => prev.filter(event => event.id !== eventId));
    await storage.deleteEvent(eventId);
    
    // Sync via Waku if connected
    if (isWakuConnected) {
      await wakuDeleteEvent(eventId);
    }
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
        nodeStats={nodeStats}
        onGetDetailedNodeInfo={getDetailedNodeInfo}
      />
      <Calendar
        calendars={calendars}
        selectedCalendars={selectedCalendars}
        events={events}
        onEventCreate={handleEventCreate}
        onEventEdit={handleEventUpdate}
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