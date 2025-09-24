import { useState, useEffect, useRef, useCallback } from 'react';
import { WakuSingleNodeManager, EventSourceAction, CalendarEvent } from '@/lib/wakuSingleNode';
import { CalendarData } from '@/lib/storage';

interface CalendarConnection {
  calendarId: string;
  encryptionKey?: string;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connected' | 'minimal';
}

export function useMultiWakuSync() {
  const [connections, setConnections] = useState<Map<string, CalendarConnection>>(new Map());
  const [globalConnectionStatus, setGlobalConnectionStatus] = useState<'disconnected' | 'connected' | 'minimal'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [pendingCalendars, setPendingCalendars] = useState<{ calendars: CalendarData[]; events: CalendarEvent[] } | null>(null);
  
  const connectionsRef = useRef<Map<string, CalendarConnection>>(new Map());
  const wakuManagerRef = useRef<WakuSingleNodeManager | null>(null);
  const eventHandlerRef = useRef<(action: EventSourceAction) => void>();

  const updateGlobalStatus = useCallback(() => {
    const connections = Array.from(connectionsRef.current.values());
    if (connections.length === 0) {
      setGlobalConnectionStatus('disconnected');
      return;
    }

    const connectedCount = connections.filter(conn => conn.isConnected).length;
    if (connectedCount === 0) {
      setGlobalConnectionStatus('disconnected');
    } else if (connectedCount === connections.length) {
      setGlobalConnectionStatus('connected');
    } else {
      setGlobalConnectionStatus('minimal');
    }
  }, []);

  // Initialize the single Waku node when needed
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
            conn.isConnected = status !== 'disconnected';
          });
          connectionsRef.current = updated;
          return updated;
        });
      },
      onError: (errorMsg) => {
        console.error('Waku node error:', errorMsg);
        setError(errorMsg);
      }
    });

    const success = await manager.initialize();
    if (success) {
      wakuManagerRef.current = manager;
    }
    
    return success;
  };

  const initializeSharedCalendars = async (sharedCalendars: CalendarData[], allEvents: CalendarEvent[]) => {
    console.log(`Queuing ${sharedCalendars.length} shared calendars for initialization...`);
    
    // Store pending calendars to initialize once Waku is connected
    setPendingCalendars({ calendars: sharedCalendars, events: allEvents });
    
    // Initialize Waku node first
    const nodeReady = await initializeWakuNode();
    
    // If node is ready and connected, initialize immediately
    if (nodeReady && (globalConnectionStatus === 'connected' || globalConnectionStatus === 'minimal')) {
      await performInitialization(sharedCalendars, allEvents);
    }
  };

  const performInitialization = async (sharedCalendars: CalendarData[], allEvents: CalendarEvent[]) => {
    setIsInitializing(true);
    setError(null);

    try {
      console.log(`Initializing calendar channels for ${sharedCalendars.length} shared calendars`);
      
      if (!wakuManagerRef.current) {
        throw new Error('Waku node manager not initialized');
      }

      const newConnections = new Map<string, CalendarConnection>();

      for (const calendar of sharedCalendars) {
        try {
          // Extract encryption key from share URL if available
          let encryptionKey: string | undefined;
          if (calendar.shareUrl) {
            const urlObj = new URL(calendar.shareUrl);
            encryptionKey = urlObj.searchParams.get('key') || undefined;
          }

          // Add calendar channel to the single Waku node
          const success = await wakuManagerRef.current.addCalendarChannel(calendar.id, encryptionKey);
          
          if (success) {
            const connection: CalendarConnection = {
              calendarId: calendar.id,
              encryptionKey,
              isConnected: globalConnectionStatus === 'connected' || globalConnectionStatus === 'minimal',
              connectionStatus: globalConnectionStatus
            };
            
            newConnections.set(calendar.id, connection);

            // Initialize sharing with historical data - use incremental sync if possible
            const calendarEvents = allEvents.filter(event => event.calendarId === calendar.id);
            const forceFullSync = !wakuManagerRef.current.canUseIncrementalSync(calendar.id);
            await wakuManagerRef.current.initializeSharing(calendar.id, calendar, calendarEvents, forceFullSync);
            
            console.log(`Initialized calendar channel: ${calendar.name} (${calendarEvents.length} events)`);
          } else {
            console.warn(`Failed to initialize channel for calendar: ${calendar.name}`);
          }
        } catch (err) {
          console.error(`Error initializing calendar ${calendar.name}:`, err);
        }
      }

      setConnections(newConnections);
      connectionsRef.current = newConnections;
      updateGlobalStatus();
      
      // Clear pending calendars since we've processed them
      setPendingCalendars(null);
      
    } catch (err) {
      setError(`Multi-sync initialization error: ${err}`);
    } finally {
      setIsInitializing(false);
    }
  };

  // Initialize pending calendars when Waku becomes connected
  useEffect(() => {
    if (pendingCalendars && (globalConnectionStatus === 'connected' || globalConnectionStatus === 'minimal')) {
      console.log('Waku connected, initializing pending calendars...');
      performInitialization(pendingCalendars.calendars, pendingCalendars.events);
    }
  }, [globalConnectionStatus, pendingCalendars]);

  const addSharedCalendar = async (calendar: CalendarData, events: CalendarEvent[]) => {
    if (connectionsRef.current.has(calendar.id)) {
      console.log(`Calendar ${calendar.id} already has a connection`);
      return;
    }

    // Ensure Waku node is initialized
    const nodeReady = await initializeWakuNode();
    if (!nodeReady) {
      setError('Failed to initialize Waku node');
      return;
    }

    // Check if Waku is connected before trying to add calendar
    if (globalConnectionStatus === 'disconnected') {
      console.log('Waku not connected, queuing calendar for later initialization...');
      // Add to pending calendars
      setPendingCalendars(prev => {
        if (prev) {
          return {
            calendars: [...prev.calendars, calendar],
            events: [...prev.events, ...events]
          };
        }
        return { calendars: [calendar], events };
      });
      return;
    }

    try {
      let encryptionKey: string | undefined;
      if (calendar.shareUrl) {
        const urlObj = new URL(calendar.shareUrl);
        encryptionKey = urlObj.searchParams.get('key') || undefined;
      }

      // Add calendar channel to the single Waku node
      const success = await wakuManagerRef.current!.addCalendarChannel(calendar.id, encryptionKey);
      
      if (success) {
        const connection: CalendarConnection = {
          calendarId: calendar.id,
          encryptionKey,
          isConnected: globalConnectionStatus === 'connected' || globalConnectionStatus === 'minimal',
          connectionStatus: globalConnectionStatus
        };
        
        setConnections(prev => {
          const updated = new Map(prev);
          updated.set(calendar.id, connection);
          connectionsRef.current = updated;
          updateGlobalStatus();
          return updated;
        });

        // Initialize sharing with historical data - use incremental sync if possible
        const calendarEvents = events.filter(event => event.calendarId === calendar.id);
        const forceFullSync = !wakuManagerRef.current!.canUseIncrementalSync(calendar.id);
        await wakuManagerRef.current!.initializeSharing(calendar.id, calendar, calendarEvents, forceFullSync);
        
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
    
    console.log(`Removed calendar channel: ${calendarId}`);
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

  const updateEvent = async (event: CalendarEvent): Promise<boolean> => {
    return wakuManagerRef.current?.updateEvent(event.calendarId, event) ?? false;
  };

  const deleteEvent = async (eventId: string, calendarId: string): Promise<boolean> => {
    return wakuManagerRef.current?.deleteEvent(calendarId, eventId) ?? false;
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
    getConnectionStats,
    generateShareUrl,
    forceFullSync,
    clearError: () => setError(null)
  };
}