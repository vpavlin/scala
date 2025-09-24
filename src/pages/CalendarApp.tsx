import { useState, useEffect } from 'react';
import { Calendar } from '@/components/Calendar';
import { CalendarSidebar } from '@/components/CalendarSidebar';
import { CalendarEventsView } from '@/components/CalendarEventsView';
import { EventDetailsPanel } from '@/components/EventDetailsPanel';
import { EventModal } from '@/components/EventModal';
import { ShareCalendarModal } from '@/components/ShareCalendarModal';
import { EventSearch } from '@/components/EventSearch';
import { DevMenu } from '@/components/DevMenu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/toaster';
import { useMultiWakuSync } from '@/hooks/useMultiWakuSync';
import { useCalendarStorage } from '@/hooks/useCalendarStorage';
import { CalendarEvent, EventSourceAction } from '@/lib/wakuSingleNode';
import { CalendarData } from '@/lib/storage';
import { generateUUID } from '@/lib/uuid';
import { isSameDay, format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

interface CalendarAppProps {
  sharedCalendarId?: string;
  sharedEncryptionKey?: string;
}

export default function CalendarApp({ sharedCalendarId, sharedEncryptionKey }: CalendarAppProps = {}) {
  const storage = useCalendarStorage();
  const multiWakuSync = useMultiWakuSync();
  const [calendars, setCalendars] = useState<CalendarData[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>([]);

  // Calculate event counts for each calendar (use filtered events for display)
  const eventCounts = filteredEvents.reduce((counts, event) => {
    counts[event.calendarId] = (counts[event.calendarId] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  // Load initial data and defer Waku initialization
  useEffect(() => {
    const loadInitialData = async () => {
      if (!storage.isInitialized) return;

      const [loadedCalendars, loadedEvents] = await Promise.all([
        storage.loadCalendars(),
        storage.loadEvents()
      ]);

      setCalendars(loadedCalendars);
      setEvents(loadedEvents);
      setFilteredEvents(loadedEvents); // Initialize filtered events

      // Don't initialize Waku immediately - wait for connection readiness
      const sharedCalendars = loadedCalendars.filter(cal => cal.isShared);
      if (sharedCalendars.length > 0) {
        console.log(`Found ${sharedCalendars.length} shared calendars, queuing for Waku initialization...`);
        await multiWakuSync.initializeSharedCalendars(sharedCalendars, loadedEvents);
      }

      // Handle shared calendar from URL
      if (sharedCalendarId && sharedEncryptionKey) {
        console.log('Loading shared calendar from URL:', sharedCalendarId);
        toast({
          title: "Joining shared calendar",
          description: "Waiting for Waku network connection..."
        });
      }
    };

    loadInitialData();
  }, [storage.isInitialized, sharedCalendarId, sharedEncryptionKey]);

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [viewingCalendarEvents, setViewingCalendarEvents] = useState<CalendarData | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const selectedCalendars = calendars.filter(cal => cal.isVisible).map(cal => cal.id);
  
  // Get events for selected calendars only
  const visibleEvents = filteredEvents.filter(event => selectedCalendars.includes(event.calendarId));

  // Setup multi-Waku event handler
  useEffect(() => {
    multiWakuSync.setEventHandler((action: EventSourceAction) => {
      console.log('Received Waku action:', action);
      
      switch (action.type) {
        case 'CREATE_EVENT':
          if (action.event) {
            // Ensure the event has a proper Date object
            const eventWithDate = {
              ...action.event,
              date: action.event.date instanceof Date ? action.event.date : new Date(action.event.date)
            };
            
            setEvents(prev => {
              // Check if event already exists to avoid duplicates
              const exists = prev.some(e => e.id === eventWithDate.id);
              if (!exists) {
                // Save the event to storage asynchronously
                storage.saveEvent(eventWithDate).catch(err => 
                  console.error('Failed to save synced event to storage:', err)
                );
                
                console.log('Added synced event:', eventWithDate.title, 'for calendar:', eventWithDate.calendarId);
                return [...prev, eventWithDate];
              }
              return prev;
            });
            toast({
              title: "Event synchronized",
              description: `"${action.event.title}" was added by another user.`
            });
          }
          break;
        case 'UPDATE_EVENT':
          if (action.event) {
            // Ensure the event has a proper Date object
            const eventWithDate = {
              ...action.event,
              date: action.event.date instanceof Date ? action.event.date : new Date(action.event.date)
            };
            
            setEvents(prev => prev.map(e => {
              if (e.id === action.eventId) {
                // Save the updated event to storage asynchronously
                storage.saveEvent(eventWithDate).catch(err => 
                  console.error('Failed to save updated synced event to storage:', err)
                );
                console.log('Updated synced event:', eventWithDate.title);
                return eventWithDate;
              }
              return e;
            }));
            toast({
              title: "Event updated",
              description: `"${action.event.title}" was updated by another user.`
            });
          }
          break;
        case 'DELETE_EVENT':
          if (action.eventId) {
            setEvents(prev => {
              const filtered = prev.filter(e => e.id !== action.eventId);
              console.log('Deleted synced event:', action.eventId);
              return filtered;
            });
            // Delete the event from storage asynchronously
            storage.deleteEvent(action.eventId).catch(err => 
              console.error('Failed to delete synced event from storage:', err)
            );
            toast({
              title: "Event deleted",
              description: "An event was deleted by another user."
            });
          }
          break;
        case 'SYNC_EVENTS':
          if (action.events && action.events.length > 0) {
            console.log('Received events sync:', action.events.length, 'events');
            
            // Ensure all events have proper Date objects
            const eventsWithDates = action.events.map(event => ({
              ...event,
              date: event.date instanceof Date ? event.date : new Date(event.date)
            }));
            
            setEvents(prev => {
              const existingIds = new Set(prev.map(e => e.id));
              const newEvents = eventsWithDates.filter(syncEvent => !existingIds.has(syncEvent.id));
              
              if (newEvents.length > 0) {
                // Save all new events to storage asynchronously
                newEvents.forEach(event => {
                  storage.saveEvent(event).catch(err => 
                    console.error('Failed to save synced event to storage:', err)
                  );
                });
                
                console.log('Added', newEvents.length, 'historical events');
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
        case 'SYNC_CALENDAR_DESCRIPTION':
          if (action.calendarId && action.description !== undefined) {
            console.log('Received calendar description sync for:', action.calendarId);
            
            setCalendars(prev => prev.map(cal => {
              if (cal.id === action.calendarId) {
                const updatedCalendar = { ...cal, description: action.description };
                
                // Save the updated calendar to storage asynchronously
                storage.saveCalendar(updatedCalendar).catch(err => 
                  console.error('Failed to save synced calendar description to storage:', err)
                );
                
                return updatedCalendar;
              }
              return cal;
            }));
            
            toast({
              title: "Calendar updated",
              description: "Calendar description was updated by another user."
            });
          }
          break;
        case 'UNSHARE_CALENDAR':
          console.log('Processing UNSHARE_CALENDAR action:', action);
          console.log('Calendar ID:', action.calendarId);
          console.log('Calendar Name:', action.calendarName);
          
          if (action.calendarId) {
            // Mark the calendar as unshared
            setCalendars(prev => prev.map(cal => 
              cal.id === action.calendarId 
                ? { ...cal, wasUnshared: true, isShared: false, shareUrl: undefined }
                : cal
            ));
            
            // Save updated calendar to storage
            const updatedCalendar = calendars.find(cal => cal.id === action.calendarId);
            if (updatedCalendar) {
              const calendarWithUnsharedFlag = { 
                ...updatedCalendar, 
                wasUnshared: true, 
                isShared: false, 
                shareUrl: undefined 
              };
              storage.saveCalendar(calendarWithUnsharedFlag).catch(err => 
                console.error('Failed to save unshared calendar state:', err)
              );
            }
            
            if (action.calendarName) {
              console.log('Showing toast for calendar unshared:', action.calendarName);
              toast({
                title: "Calendar no longer shared",
                description: `"${action.calendarName}" is no longer being shared. You will not receive further updates unless it's shared again.`,
                variant: "default"
              });
            } else {
              // Fallback toast if name is missing
              toast({
                title: "Calendar no longer shared",
                description: "A shared calendar is no longer being shared. You will not receive further updates unless it's shared again.",
                variant: "default"
              });
            }
          } else {
            console.log('Missing calendarId in UNSHARE_CALENDAR action');
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

  // Show connection readiness
  useEffect(() => {
    if (multiWakuSync.globalConnectionStatus === 'connected' || multiWakuSync.globalConnectionStatus === 'minimal') {
      console.log('Waku network is ready for reliable channels');
    }
  }, [multiWakuSync.globalConnectionStatus]);

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
    const prevCalendar = calendars.find(cal => cal.id === updatedCalendar.id);
    
    setCalendars(prev => prev.map(cal => 
      cal.id === updatedCalendar.id ? updatedCalendar : cal
    ));
    await storage.saveCalendar(updatedCalendar);
    
    // Sync description to Waku if calendar is shared and description changed
    if (updatedCalendar.isShared && prevCalendar?.description !== updatedCalendar.description) {
      await multiWakuSync.syncCalendarDescription(updatedCalendar.id, updatedCalendar.description || '');
    }
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
      
      // Sync description to Waku if calendar is shared and description was updated
      if (updatedCalendar.isShared && 'description' in updates) {
        await multiWakuSync.syncCalendarDescription(calendarId, updates.description || '');
      }
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

    console.log('Configuring calendar sharing:', calendar.name, 'ID:', calendarId, 'Private:', isPrivate);

    // Generate share URL manually
    const baseUrl = window.location.origin;
    const params = new URLSearchParams({
      calendar: calendarId,
      name: encodeURIComponent(calendar.name)
    });
    
    if (isPrivate) {
      // Generate a simple encryption key for private calendars
      const encryptionKey = btoa(calendarId + Date.now()).slice(0, 16);
      params.set('key', encryptionKey);
    }
    
    const shareUrl = `${baseUrl}/shared?${params.toString()}`;
    console.log('Generated share URL:', shareUrl);

    const updatedCalendar = { 
      ...calendar, 
      isShared: true, 
      isPrivate,
      shareUrl
    };

    // Update state first
    setCalendars(prev => prev.map(cal => 
      cal.id === calendarId ? updatedCalendar : cal
    ));
    
    // Save to storage
    try {
      await storage.saveCalendar(updatedCalendar);
      console.log('Calendar updated successfully:', updatedCalendar);
    } catch (error) {
      console.error('Failed to save calendar:', error);
      toast({
        title: "Error",
        description: "Failed to save calendar sharing settings.",
        variant: "destructive"
      });
      return;
    }

    // Add Waku sync for this calendar
    const calendarEvents = events.filter(event => event.calendarId === calendarId);
    await multiWakuSync.addSharedCalendar(updatedCalendar, calendarEvents);
    
    toast({
      title: "Calendar sharing configured",
      description: `Calendar "${calendar.name}" sharing settings have been updated.`
    });
  };

  const handleCalendarShareToggle = async (calendarId: string, isSharing: boolean) => {
    const calendar = calendars.find(cal => cal.id === calendarId);
    if (!calendar) return;

    console.log('Toggling calendar sharing:', calendar.name, 'ID:', calendarId, 'Sharing:', isSharing);

    if (isSharing) {
      // Enable sharing with default settings (non-private)
      const baseUrl = window.location.origin;
      const params = new URLSearchParams({
        calendar: calendarId,
        name: encodeURIComponent(calendar.name)
      });
      
      const shareUrl = `${baseUrl}/shared?${params.toString()}`;

      const updatedCalendar = { 
        ...calendar, 
        isShared: true, 
        isPrivate: false,
        shareUrl
      };

      // Update state first
      setCalendars(prev => prev.map(cal => 
        cal.id === calendarId ? updatedCalendar : cal
      ));
      
      // Save to storage
      try {
        await storage.saveCalendar(updatedCalendar);
        console.log('Calendar sharing enabled:', updatedCalendar);
      } catch (error) {
        console.error('Failed to save calendar:', error);
        toast({
          title: "Error",
          description: "Failed to enable calendar sharing.",
          variant: "destructive"
        });
        return;
      }

      // Add Waku sync for this calendar
      const calendarEvents = events.filter(event => event.calendarId === calendarId);
      await multiWakuSync.addSharedCalendar(updatedCalendar, calendarEvents);
      
      toast({
        title: "Calendar sharing enabled",
        description: `Calendar "${calendar.name}" is now being shared via Waku.`
      });
    } else {
      // Disable sharing
      const updatedCalendar = { 
        ...calendar, 
        isShared: false, 
        isPrivate: false,
        shareUrl: undefined
      };

      // Update state first
      setCalendars(prev => prev.map(cal => 
        cal.id === calendarId ? updatedCalendar : cal
      ));
      
      // Save to storage
      try {
        // Send unshare notification to subscribers before disconnecting
        await multiWakuSync.unshareCalendar(calendarId, calendar.name);
        
        // Wait a moment for the message to be sent
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Remove Waku sync for this calendar
        await multiWakuSync.removeSharedCalendar(calendarId);
        
        toast({
          title: "Calendar sharing disabled",
          description: `Calendar "${calendar.name}" is no longer being shared.`
        });
      } catch (error) {
        console.error('Error disabling calendar sharing:', error);
        toast({
          title: "Error",
          description: "Failed to disable calendar sharing.",
          variant: "destructive"
        });
        return;
      }
    }
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
    // Get the original event before updating
    const originalEvent = events.find(event => event.id === updatedEvent.id);
    
    // Update locally first
    setEvents(prev => prev.map(event => 
      event.id === updatedEvent.id ? updatedEvent : event
    ));
    await storage.saveEvent(updatedEvent);
    
    // Sync via Waku if calendar is shared
    const updatedCalendar = calendars.find(cal => cal.id === updatedEvent.calendarId);
    if (updatedCalendar?.isShared || (originalEvent && calendars.find(cal => cal.id === originalEvent.calendarId)?.isShared)) {
      await multiWakuSync.updateEvent(updatedEvent, originalEvent);
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
    try {
      // Validate the event data before setting it
      if (!event || !event.id || !event.title || !event.date) {
        console.error('Invalid event data:', event);
        toast({
          title: "Error",
          description: "This event has invalid data and cannot be displayed.",
          variant: "destructive"
        });
        return;
      }

      // Ensure the event has a proper Date object
      const validatedEvent = {
        ...event,
        date: event.date instanceof Date ? event.date : new Date(event.date)
      };

      // Check if the event's calendar exists
      const calendar = calendars.find(cal => cal.id === validatedEvent.calendarId);
      if (!calendar) {
        console.error('Calendar not found for event:', validatedEvent.calendarId);
        toast({
          title: "Error", 
          description: "The calendar for this event could not be found.",
          variant: "destructive"
        });
        return;
      }

      setSelectedEvent(validatedEvent);
    } catch (error) {
      console.error('Error handling event click:', error);
      toast({
        title: "Error",
        description: "Failed to open event details.",
        variant: "destructive"
      });
    }
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

  const handleCalendarNameClick = (calendar: CalendarData) => {
    setViewingCalendarEvents(calendar);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      <div 
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 lg:hidden ${
          isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsSidebarOpen(false)}
      />
      
      <div className="flex min-h-screen">
        {/* Mobile sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 w-80 bg-card border-r border-border transform transition-transform duration-300 lg:relative lg:transform-none lg:z-auto ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}>
          <CalendarSidebar
            calendars={calendars}
            selectedCalendars={selectedCalendars}
            eventCounts={eventCounts}
            onCalendarToggle={handleCalendarToggle}
            onCalendarCreate={handleCalendarCreate}
            onCalendarEdit={handleCalendarEdit}
            onCalendarDelete={handleCalendarDelete}
            onCalendarShare={handleCalendarShare}
            onCalendarShareToggle={handleCalendarShareToggle}
            onCalendarNameClick={handleCalendarNameClick}
            connectionStatus={multiWakuSync.globalConnectionStatus}
            isWakuConnected={multiWakuSync.globalConnectionStatus !== 'disconnected'}
            connectionStats={multiWakuSync.getConnectionStats()}
            onClose={() => setIsSidebarOpen(false)}
            isMobile={true}
          />
        </div>

        {/* Main content area - flex row to accommodate sidebar */}
        <div className="flex-1 flex">
          {/* Primary content */}
          <div className="flex-1 flex flex-col min-w-0">
            {viewingCalendarEvents ? (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b bg-card">
                  <EventSearch 
                    events={events.filter(e => e.calendarId === viewingCalendarEvents.id)}
                    onFilteredEventsChange={(filtered) => setFilteredEvents(filtered)}
                  />
                </div>
                <div className="flex-1 p-6">
                  <CalendarEventsView
                    calendar={viewingCalendarEvents}
                    events={filteredEvents.filter(e => e.calendarId === viewingCalendarEvents.id)}
                    onBack={() => setViewingCalendarEvents(null)}
                    onEventClick={handleEventClick}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="p-4 border-b bg-card">
                  <EventSearch 
                    events={events}
                    onFilteredEventsChange={(filtered) => setFilteredEvents(filtered)}
                  />
                </div>
                <div className="flex-1">
                  <Calendar
                    calendars={calendars}
                    selectedCalendars={selectedCalendars}
                    events={visibleEvents}
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
                    onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    isSidebarOpen={isSidebarOpen}
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* Event details panel - desktop sidebar, mobile overlay */}
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
      </div>
      
      {/* Development Menu */}
      <DevMenu
        onClearDatabase={handleClearDatabase}
        onPopulateExampleData={handlePopulateExampleData}
      />
    </div>
  );
}