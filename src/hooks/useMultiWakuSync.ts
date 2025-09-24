import { useState, useRef, useEffect } from 'react';
import { WakuSingleNodeManager, EventSourceAction, CalendarEvent } from '@/lib/wakuSingleNode';

interface CalendarConnection {
  calendarId: string;
  encryptionKey?: string;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connected' | 'minimal';
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isShared?: boolean;
  isPrivate?: boolean;
  shareUrl?: string;
  description?: string;
  wasUnshared?: boolean;
}

export function useMultiWakuSync() {
  const [connections, setConnections] = useState<Map<string, CalendarConnection>>(new Map());
  const [globalConnectionStatus, setGlobalConnectionStatus] = useState<'connected' | 'disconnected' | 'minimal'>('disconnected');
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wakuManagerRef = useRef<WakuSingleNodeManager | null>(null);
  const eventHandlerRef = useRef<((action: EventSourceAction) => void) | null>(null);
  const connectionsRef = useRef<Map<string, CalendarConnection>>(new Map());

  // Update global connection status based on individual connections
  const updateGlobalStatus = () => {
    const connectionArray = Array.from(connectionsRef.current.values());
    if (connectionArray.length === 0) {
      setGlobalConnectionStatus('disconnected');
      return;
    }
    
    const connectedCount = connectionArray.filter(conn => conn.isConnected).length;
    if (connectedCount === connectionArray.length) {
      setGlobalConnectionStatus('connected');
    } else if (connectedCount > 0) {
      setGlobalConnectionStatus('minimal');
    } else {
      setGlobalConnectionStatus('disconnected');
    }
  };

  const initializeWakuNode = async (): Promise<boolean> => {
    if (wakuManagerRef.current) {
      return wakuManagerRef.current.getConnectionStatus();
    }

    const manager = new WakuSingleNodeManager();
    
    manager.setEventHandlers({
      onEventAction: (action) => {
        eventHandlerRef.current?.(action);
      },
      onConnectionStatus: (status) => {
        setGlobalConnectionStatus(status);
        
        // Update all connection statuses
        setConnections(prev => {
          const updated = new Map(prev);
          updated.forEach((conn, calendarId) => {
            conn.connectionStatus = status;
            conn.isConnected = status === 'connected';
          });
          connectionsRef.current = updated;
          return updated;
        });
      },
      onError: (error) => {
        console.error('Waku error:', error);
        setError(error);
      }
    });

    setIsInitializing(true);
    try {
      const success = await manager.initialize();
      wakuManagerRef.current = manager;
      setError(null);
      return success;
    } catch (err) {
      console.error('Failed to initialize Waku node:', err);
      setError(`Failed to initialize Waku: ${err}`);
      return false;
    } finally {
      setIsInitializing(false);
    }
  };

  const initializeSharedCalendars = async (sharedCalendars: CalendarData[], allEvents: CalendarEvent[]) => {
    if (sharedCalendars.length === 0) return;

    console.log('Initializing shared calendars:', sharedCalendars.map(cal => cal.name));
    
    // Ensure Waku node is initialized
    const nodeReady = wakuManagerRef.current || await initializeWakuNode();
    if (!nodeReady) {
      console.error('Failed to initialize Waku node for shared calendars');
      return;
    }

    // Small delay to ensure node is fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    await performInitialization(sharedCalendars, allEvents);
  };

  const performInitialization = async (sharedCalendars: CalendarData[], allEvents: CalendarEvent[]) => {
    for (const calendar of sharedCalendars) {
      const calendarEvents = allEvents.filter(event => event.calendarId === calendar.id);
      await addSharedCalendar(calendar, calendarEvents);
    }
  };

  const addSharedCalendar = async (calendar: CalendarData, events: CalendarEvent[]) => {
    if (!wakuManagerRef.current) {
      console.error('Waku manager not initialized');
      return;
    }

    try {
      // Add the calendar channel
      const encryptionKey = calendar.isPrivate ? btoa(`${calendar.id}-${Date.now()}`).substring(0, 16) : undefined;
      const success = await wakuManagerRef.current.addCalendarChannel(calendar.id, encryptionKey);
      
      if (success) {
        // Create connection entry
        const connection: CalendarConnection = {
          calendarId: calendar.id,
          encryptionKey,
          isConnected: true,
          connectionStatus: 'connected'
        };

        setConnections(prev => {
          const updated = new Map(prev);
          updated.set(calendar.id, connection);
          connectionsRef.current = updated;
          updateGlobalStatus();
          return updated;
        });

        // Initialize sharing with historical data
        await wakuManagerRef.current.initializeSharing(calendar.id, calendar, events);
        
        console.log(`Added calendar channel: ${calendar.name}`);
      }
    } catch (err) {
      console.error(`Error adding shared calendar ${calendar.name}:`, err);
      setError(`Failed to add shared calendar: ${err}`);
    }
  };

  const removeSharedCalendar = async (calendarId: string) => {
    if (wakuManagerRef.current) {
      await wakuManagerRef.current.removeCalendarChannel(calendarId);
    }
    
    setConnections(prev => {
      const updated = new Map(prev);
      updated.delete(calendarId);
      connectionsRef.current = updated;
      updateGlobalStatus();
      return updated;
    });
    
    console.log(`Removed shared calendar: ${calendarId}`);
  };

  const disconnectAll = async () => {
    if (wakuManagerRef.current) {
      await wakuManagerRef.current.disconnect();
      wakuManagerRef.current = null;
    }
    
    setConnections(new Map());
    connectionsRef.current = new Map();
    setGlobalConnectionStatus('disconnected');
    console.log('Disconnected Waku node and all channels');
  };

  const setEventHandler = (handler: (action: EventSourceAction) => void) => {
    eventHandlerRef.current = handler;
  };

  // Event operations - route to appropriate calendar channel
  const createEvent = async (event: CalendarEvent): Promise<boolean> => {
    return wakuManagerRef.current?.createEvent(event.calendarId, event) ?? false;
  };

  const updateEvent = async (event: CalendarEvent, originalEvent?: CalendarEvent): Promise<boolean> => {
    // Handle cross-calendar moves
    if (originalEvent && originalEvent.calendarId !== event.calendarId) {
      // Check if calendars are shared before syncing
      const originalCalendarConnection = connectionsRef.current.get(originalEvent.calendarId);
      const newCalendarConnection = connectionsRef.current.get(event.calendarId);
      
      let success = true;
      
      // Delete from old calendar if it's shared
      if (originalCalendarConnection) {
        const deleteSuccess = await wakuManagerRef.current?.deleteEvent(originalEvent.calendarId, event.id) ?? false;
        success = success && deleteSuccess;
      }
      
      // Create in new calendar if it's shared
      if (newCalendarConnection) {
        const createSuccess = await wakuManagerRef.current?.createEvent(event.calendarId, event) ?? false;
        success = success && createSuccess;
      }
      
      return success;
    }
    
    // Regular update within same calendar (only if shared)
    const calendarConnection = connectionsRef.current.get(event.calendarId);
    if (calendarConnection) {
      return wakuManagerRef.current?.updateEvent(event.calendarId, event) ?? false;
    }
    
    return true; // Non-shared calendar, consider it successful
  };

  const deleteEvent = async (eventId: string, calendarId: string): Promise<boolean> => {
    return wakuManagerRef.current?.deleteEvent(calendarId, eventId) ?? false;
  };

  const syncCalendarDescription = async (calendarId: string, description: string): Promise<boolean> => {
    return wakuManagerRef.current?.syncCalendarDescription(calendarId, description) ?? false;
  };

  const unshareCalendar = async (calendarId: string, calendarName: string): Promise<boolean> => {
    return wakuManagerRef.current?.unshareCalendar(calendarId, calendarName) ?? false;
  };

  // Removed syncCalendar - we no longer sync calendar metadata
  // Users can rename, recolor, and toggle shared calendars locally

  const getConnectionStats = () => {
    const connections = Array.from(connectionsRef.current.values());
    return {
      totalConnections: connections.length,
      connectedCount: connections.filter(conn => conn.isConnected).length,
      connections: connections.map(conn => ({
        calendarId: conn.calendarId,
        isConnected: conn.isConnected,
        status: conn.connectionStatus
      })),
      nodeStats: wakuManagerRef.current?.getNodeStats() || null
    };
  };

  const generateShareUrl = (calendarId: string, calendarName: string): string => {
    return wakuManagerRef.current?.generateShareUrl(calendarId, calendarName, 
      connectionsRef.current.get(calendarId)?.encryptionKey) ?? '';
  };
  
  // Method to force full sync for a calendar (useful for troubleshooting)
  const forceFullSync = async (calendarId: string, calendar: CalendarData, events: CalendarEvent[]): Promise<boolean> => {
    if (!wakuManagerRef.current) return false;
    
    wakuManagerRef.current.resetSyncState(calendarId);
    const calendarEvents = events.filter(event => event.calendarId === calendarId);
    return wakuManagerRef.current.initializeSharing(calendarId, calendar, calendarEvents, true);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectAll();
    };
  }, []);

  return {
    connections: Array.from(connections.values()),
    globalConnectionStatus,
    isInitializing,
    error,
    initializeSharedCalendars,
    addSharedCalendar,
    removeSharedCalendar,
    disconnectAll,
    setEventHandler,
    createEvent,
    updateEvent,
    deleteEvent,
    syncCalendarDescription,
    unshareCalendar,
    getConnectionStats,
    generateShareUrl,
    forceFullSync,
    clearError: () => setError(null)
  };
}