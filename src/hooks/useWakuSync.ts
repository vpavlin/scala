import { useState, useEffect, useRef } from 'react';
import { WakuCalendarSync, EventSourceAction, CalendarEvent } from '@/lib/wakuSync';

export function useWakuSync(calendarId?: string, encryptionKey?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'minimal'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  
  const wakuSyncRef = useRef<WakuCalendarSync | null>(null);
  const eventHandlerRef = useRef<(action: EventSourceAction) => void>();

  const initializeWaku = async (channelId: string, key?: string) => {
    if (wakuSyncRef.current) {
      await wakuSyncRef.current.disconnect();
    }

    setIsInitializing(true);
    setError(null);

    try {
      const wakuSync = new WakuCalendarSync(channelId, key);
      
      wakuSync.setEventHandlers({
        onEventAction: (action) => {
          eventHandlerRef.current?.(action);
        },
        onConnectionStatus: (status) => {
          setConnectionStatus(status);
          setIsConnected(status !== 'disconnected');
        },
        onError: (errorMsg) => {
          setError(errorMsg);
        }
      });

      const success = await wakuSync.initialize();
      
      if (success) {
        wakuSyncRef.current = wakuSync;
      } else {
        setError('Failed to initialize Waku connection');
      }
    } catch (err) {
      setError(`Initialization error: ${err}`);
    } finally {
      setIsInitializing(false);
    }
  };

  const disconnect = async () => {
    if (wakuSyncRef.current) {
      await wakuSyncRef.current.disconnect();
      wakuSyncRef.current = null;
      setIsConnected(false);
      setConnectionStatus('disconnected');
    }
  };

  const setEventHandler = (handler: (action: EventSourceAction) => void) => {
    eventHandlerRef.current = handler;
  };

  const createEvent = async (event: CalendarEvent): Promise<boolean> => {
    return wakuSyncRef.current?.createEvent(event) ?? false;
  };

  const updateEvent = async (event: CalendarEvent): Promise<boolean> => {
    return wakuSyncRef.current?.updateEvent(event) ?? false;
  };

  const deleteEvent = async (eventId: string): Promise<boolean> => {
    return wakuSyncRef.current?.deleteEvent(eventId) ?? false;
  };

  const generateShareUrl = (calendarId: string, encryptionKey?: string): string => {
    return wakuSyncRef.current?.generateShareUrl(calendarId, encryptionKey) ?? '';
  };

  // Auto-initialize if calendarId is provided
  useEffect(() => {
    if (calendarId) {
      initializeWaku(calendarId, encryptionKey);
    }

    return () => {
      disconnect();
    };
  }, [calendarId, encryptionKey]);

  return {
    isConnected,
    connectionStatus,
    isInitializing,
    error,
    initializeWaku,
    disconnect,
    setEventHandler,
    createEvent,
    updateEvent,
    deleteEvent,
    generateShareUrl,
    clearError: () => setError(null)
  };
}