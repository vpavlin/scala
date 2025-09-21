import { useState, useEffect } from 'react';
import { Calendar } from '@/components/Calendar';
import { CalendarSidebar } from '@/components/CalendarSidebar';
import { EventDetailsPanel } from '@/components/EventDetailsPanel';
import { EventModal } from '@/components/EventModal';
import { ShareCalendarModal } from '@/components/ShareCalendarModal';
import { DevMenu } from '@/components/DevMenu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/toaster';
import { useMultiWakuSync } from '@/hooks/useMultiWakuSync';
import { useCalendarStorage } from '@/hooks/useCalendarStorage';
import { CalendarEvent, EventSourceAction } from '@/lib/wakuSync';
import { CalendarData } from '@/lib/storage';
import { generateUUID } from '@/lib/uuid';
import { isSameDay, format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

const defaultCalendars: CalendarData[] = [
  {
    id: generateUUID(),
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
  const multiWakuSync = useMultiWakuSync();
  const [calendars, setCalendars] = useState<CalendarData[]>(defaultCalendars);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // Load initial data and initialize Waku for shared calendars
  useEffect(() => {
    const loadInitialData = async () => {
      if (!storage.isInitialized) return;

      const [loadedCalendars, loadedEvents] = await Promise.all([
        storage.loadCalendars(),
        storage.loadEvents()
      ]);

      // Use stored calendars if available, otherwise use defaults
      if (loadedCalendars.length > 0) {
        setCalendars(loadedCalendars);
      } else {
        // Save default calendars to storage
        for (const calendar of defaultCalendars) {
          await storage.saveCalendar(calendar);
        }
        setCalendars(defaultCalendars);
      }

      setEvents(loadedEvents);

      // Initialize Waku sync for all shared calendars
      const sharedCalendars = loadedCalendars.filter(cal => cal.isShared);
      if (sharedCalendars.length > 0) {
        console.log(`Found ${sharedCalendars.length} shared calendars, initializing Waku sync...`);
        await multiWakuSync.initializeSharedCalendars(sharedCalendars, loadedEvents);
      }

      // Handle shared calendar from URL
      if (sharedCalendarId && sharedEncryptionKey) {
        console.log('Loading shared calendar from URL:', sharedCalendarId);
        toast({
          title: "Joining shared calendar",
          description: "Connecting to Waku network and loading calendar data..."
        });
      }
    };

    loadInitialData();
  }, [storage.isInitialized, sharedCalendarId, sharedEncryptionKey]);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const selectedCalendars = calendars.filter(cal => cal.isVisible).map(cal => cal.id);

  // Setup multi-Waku event handler
  useEffect(() => {
    multiWakuSync.setEventHandler((action: EventSourceAction) => {
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
              const existingIds = new Set(prev.map(e => e.id));
              const newEvents = action.events!.filter(syncEvent => !existingIds.has(syncEvent.id));
              if (newEvents.length > 0) {
                toast({
                  title: "Events synchronized",
                  description: `${newEvents.length} historical events were loaded.`
                });
                return [...prev, ...newEvents];
              }
              return prev;
            });
          }
          break;
      }
    });
  }, []);

  // Show Waku errors and connection status for shared calendars
  useEffect(() => {
    if (multiWakuSync.error) {
      toast({
        title: "Sync Error",
        description: multiWakuSync.error,
        variant: "destructive"
      });
      multiWakuSync.clearError();
    }
  }, [multiWakuSync.error]);

  // Show connection success for shared calendars
  useEffect(() => {
    if (sharedCalendarId && multiWakuSync.globalConnectionStatus !== 'disconnected') {
      toast({
        title: "Connected to shared calendar",
        description: "You are now receiving live updates from this calendar."
      });
    }
  }, [sharedCalendarId, multiWakuSync.globalConnectionStatus]);

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
      id: generateUUID()
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
    const calendarToDelete = calendars.find(cal => cal.id === calendarId);
    
    // Remove Waku sync if calendar is shared
    if (calendarToDelete?.isShared) {
      await multiWakuSync.removeSharedCalendar(calendarId);
    }
    
    setCalendars(prev => prev.filter(cal => cal.id !== calendarId));
    setEvents(prev => prev.filter(event => event.calendarId !== calendarId));
    await storage.deleteCalendar(calendarId);
  };

  const handleCalendarShare = async (calendarId: string, isPrivate: boolean) => {
    const calendar = calendars.find(cal => cal.id === calendarId);
    if (!calendar) return;

    const updatedCalendar = { 
      ...calendar, 
      isShared: true, 
      isPrivate,
      shareUrl: multiWakuSync.generateShareUrl(calendarId)
    };

    setCalendars(prev => prev.map(cal => 
      cal.id === calendarId ? updatedCalendar : cal
    ));
    await storage.saveCalendar(updatedCalendar);

    // Add Waku sync for this calendar
    const calendarEvents = events.filter(event => event.calendarId === calendarId);
    await multiWakuSync.addSharedCalendar(updatedCalendar, calendarEvents);
    
    toast({
      title: "Calendar shared",
      description: `Calendar "${calendar.name}" is now being shared via Waku.`
    });
  };

  const handleEventCreate = async (eventData: Omit<CalendarEvent, 'id'>) => {
    const event: CalendarEvent = {
      ...eventData,
      id: generateUUID()
    };
    
    // Add locally first
    setEvents(prev => [...prev, event]);
    await storage.saveEvent(event);
    
    // Sync via Waku if calendar is shared
    const calendar = calendars.find(cal => cal.id === event.calendarId);
    if (calendar?.isShared) {
      await multiWakuSync.createEvent(event);
    }
  };

  const handleEventUpdate = async (updatedEvent: CalendarEvent) => {
    // Update locally first
    setEvents(prev => prev.map(event => 
      event.id === updatedEvent.id ? updatedEvent : event
    ));
    await storage.saveEvent(updatedEvent);
    
    // Sync via Waku if calendar is shared
    const calendar = calendars.find(cal => cal.id === updatedEvent.calendarId);
    if (calendar?.isShared) {
      await multiWakuSync.updateEvent(updatedEvent);
    }
  };

  const handleEventDelete = async (eventId: string) => {
    const eventToDelete = events.find(event => event.id === eventId);
    if (!eventToDelete) return;

    // Delete locally first
    setEvents(prev => prev.filter(event => event.id !== eventId));
    await storage.deleteEvent(eventId);
    
    // Sync via Waku if calendar is shared
    const calendar = calendars.find(cal => cal.id === eventToDelete.calendarId);
    if (calendar?.isShared) {
      await multiWakuSync.deleteEvent(eventId, eventToDelete.calendarId);
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  // Dev utilities
  const handleClearDatabase = async () => {
    await storage.clearAllData();
    setCalendars([]);
    setEvents([]);
    setSelectedEvent(null);
    setEditingEvent(null);
    setIsEditModalOpen(false);
  };

  const handlePopulateExampleData = async (exampleCalendars: CalendarData[], exampleEvents: CalendarEvent[]) => {
    // Add calendars
    for (const calendar of exampleCalendars) {
      await storage.saveCalendar(calendar);
    }
    setCalendars(prev => [...prev, ...exampleCalendars]);

    // Add events
    for (const event of exampleEvents) {
      await storage.saveEvent(event);
    }
    setEvents(prev => [...prev, ...exampleEvents]);
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
        connectionStatus={multiWakuSync.globalConnectionStatus}
        isWakuConnected={multiWakuSync.globalConnectionStatus !== 'disconnected'}
        connectionStats={multiWakuSync.getConnectionStats()}
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
      
      {/* Development Menu */}
      <DevMenu
        onClearDatabase={handleClearDatabase}
        onPopulateExampleData={handlePopulateExampleData}
      />
    </div>
  );
}