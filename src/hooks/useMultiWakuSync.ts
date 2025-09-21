import { useState, useEffect, useRef, useCallback } from 'react';
import { WakuCalendarSync, EventSourceAction, CalendarEvent } from '@/lib/wakuSync';
import { CalendarData } from '@/lib/storage';

interface WakuConnection {
  calendarId: string;
  encryptionKey?: string;
  sync: WakuCalendarSync;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connected' | 'minimal';
}

export function useMultiWakuSync() {
  const [connections, setConnections] = useState<Map<string, WakuConnection>>(new Map());
  const [globalConnectionStatus, setGlobalConnectionStatus] = useState<'disconnected' | 'connected' | 'minimal'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const connectionsRef = useRef<Map<string, WakuConnection>>(new Map());
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

  const initializeSharedCalendars = async (sharedCalendars: CalendarData[], allEvents: CalendarEvent[]) => {
    setIsInitializing(true);
    setError(null);

    try {
      console.log(`Initializing Waku sync for ${sharedCalendars.length} shared calendars`);
      
      const newConnections = new Map<string, WakuConnection>();

      for (const calendar of sharedCalendars) {
        try {
          // Extract encryption key from share URL if available
          let encryptionKey: string | undefined;
          if (calendar.shareUrl) {
            const urlObj = new URL(calendar.shareUrl);
            encryptionKey = urlObj.searchParams.get('key') || undefined;
          }

          const wakuSync = new WakuCalendarSync(calendar.id, encryptionKey);
          
          wakuSync.setEventHandlers({
            onEventAction: (action) => {
              eventHandlerRef.current?.(action);
            },
            onConnectionStatus: (status) => {
              setConnections(prev => {
                const updated = new Map(prev);
                const connection = updated.get(calendar.id);
                if (connection) {
                  connection.connectionStatus = status;
                  connection.isConnected = status !== 'disconnected';
                  connectionsRef.current = updated;
                  updateGlobalStatus();
                }
                return updated;
              });
            },
            onError: (errorMsg) => {
              console.error(`Waku error for calendar ${calendar.id}:`, errorMsg);
              setError(`Calendar ${calendar.name}: ${errorMsg}`);
            }
          });

          const success = await wakuSync.initialize();
          
          if (success) {
            const connection: WakuConnection = {
              calendarId: calendar.id,
              encryptionKey,
              sync: wakuSync,
              isConnected: false,
              connectionStatus: 'disconnected'
            };
            
            newConnections.set(calendar.id, connection);

            // Initialize sharing with historical data
            const calendarEvents = allEvents.filter(event => event.calendarId === calendar.id);
            await wakuSync.initializeSharing(calendar, calendarEvents);
            
            console.log(`Initialized Waku sync for calendar: ${calendar.name} (${calendarEvents.length} events)`);
          } else {
            console.warn(`Failed to initialize Waku for calendar: ${calendar.name}`);
          }
        } catch (err) {
          console.error(`Error initializing calendar ${calendar.name}:`, err);
        }
      }

      setConnections(newConnections);
      connectionsRef.current = newConnections;
      updateGlobalStatus();
      
    } catch (err) {
      setError(`Multi-sync initialization error: ${err}`);
    } finally {
      setIsInitializing(false);
    }
  };

  const addSharedCalendar = async (calendar: CalendarData, events: CalendarEvent[]) => {
    if (connectionsRef.current.has(calendar.id)) {
      console.log(`Calendar ${calendar.id} already has a Waku connection`);
      return;
    }

    try {
      let encryptionKey: string | undefined;
      if (calendar.shareUrl) {
        const urlObj = new URL(calendar.shareUrl);
        encryptionKey = urlObj.searchParams.get('key') || undefined;
      }

      const wakuSync = new WakuCalendarSync(calendar.id, encryptionKey);
      
      wakuSync.setEventHandlers({
        onEventAction: (action) => {
          eventHandlerRef.current?.(action);
        },
        onConnectionStatus: (status) => {
          setConnections(prev => {
            const updated = new Map(prev);
            const connection = updated.get(calendar.id);
            if (connection) {
              connection.connectionStatus = status;
              connection.isConnected = status !== 'disconnected';
              connectionsRef.current = updated;
              updateGlobalStatus();
            }
            return updated;
          });
        },
        onError: (errorMsg) => {
          setError(`Calendar ${calendar.name}: ${errorMsg}`);
        }
      });

      const success = await wakuSync.initialize();
      
      if (success) {
        const connection: WakuConnection = {
          calendarId: calendar.id,
          encryptionKey,
          sync: wakuSync,
          isConnected: false,
          connectionStatus: 'disconnected'
        };
        
        setConnections(prev => {
          const updated = new Map(prev);
          updated.set(calendar.id, connection);
          connectionsRef.current = updated;
          updateGlobalStatus();
          return updated;
        });

        // Initialize sharing with historical data
        const calendarEvents = events.filter(event => event.calendarId === calendar.id);
        await wakuSync.initializeSharing(calendar, calendarEvents);
        
        console.log(`Added Waku sync for calendar: ${calendar.name}`);
      }
    } catch (err) {
      console.error(`Error adding shared calendar ${calendar.name}:`, err);
      setError(`Failed to add shared calendar: ${err}`);
    }
  };

  const removeSharedCalendar = async (calendarId: string) => {
    const connection = connectionsRef.current.get(calendarId);
    if (connection) {
      await connection.sync.disconnect();
      
      setConnections(prev => {
        const updated = new Map(prev);
        updated.delete(calendarId);
        connectionsRef.current = updated;
        updateGlobalStatus();
        return updated;
      });
      
      console.log(`Removed Waku sync for calendar: ${calendarId}`);
    }
  };

  const disconnectAll = async () => {
    const connections = Array.from(connectionsRef.current.values());
    await Promise.all(connections.map(conn => conn.sync.disconnect()));
    
    setConnections(new Map());
    connectionsRef.current = new Map();
    setGlobalConnectionStatus('disconnected');
    console.log('Disconnected all Waku syncs');
  };

  const setEventHandler = (handler: (action: EventSourceAction) => void) => {
    eventHandlerRef.current = handler;
  };

  // Event operations - route to appropriate connection
  const createEvent = async (event: CalendarEvent): Promise<boolean> => {
    const connection = connectionsRef.current.get(event.calendarId);
    return connection?.sync.createEvent(event) ?? false;
  };

  const updateEvent = async (event: CalendarEvent): Promise<boolean> => {
    const connection = connectionsRef.current.get(event.calendarId);
    return connection?.sync.updateEvent(event) ?? false;
  };

  const deleteEvent = async (eventId: string, calendarId: string): Promise<boolean> => {
    const connection = connectionsRef.current.get(calendarId);
    return connection?.sync.deleteEvent(eventId) ?? false;
  };

  const syncCalendar = async (calendar: CalendarData): Promise<boolean> => {
    const connection = connectionsRef.current.get(calendar.id);
    return connection?.sync.syncCalendar(calendar) ?? false;
  };

  const getConnectionStats = () => {
    const connections = Array.from(connectionsRef.current.values());
    return {
      totalConnections: connections.length,
      connectedCount: connections.filter(conn => conn.isConnected).length,
      connections: connections.map(conn => ({
        calendarId: conn.calendarId,
        isConnected: conn.isConnected,
        status: conn.connectionStatus
      }))
    };
  };

  const generateShareUrl = (calendarId: string): string => {
    const connection = connectionsRef.current.get(calendarId);
    return connection?.sync.generateShareUrl(calendarId, connection.encryptionKey) ?? '';
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
    syncCalendar,
    getConnectionStats,
    generateShareUrl,
    clearError: () => setError(null)
  };
}