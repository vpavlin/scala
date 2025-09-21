import { useState, useEffect } from 'react';
import { calendarStorage, CalendarData } from '@/lib/storage';
import { CalendarEvent } from '@/lib/wakuSingleNode';

export function useCalendarStorage() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initStorage = async () => {
      try {
        await calendarStorage.init();
        setIsInitialized(true);
      } catch (err) {
        setError(`Failed to initialize storage: ${err}`);
      }
    };

    initStorage();
  }, []);

  const loadCalendars = async (): Promise<CalendarData[]> => {
    try {
      return await calendarStorage.getCalendars();
    } catch (err) {
      setError(`Failed to load calendars: ${err}`);
      return [];
    }
  };

  const saveCalendar = async (calendar: CalendarData): Promise<boolean> => {
    try {
      await calendarStorage.saveCalendar(calendar);
      return true;
    } catch (err) {
      setError(`Failed to save calendar: ${err}`);
      return false;
    }
  };

  const deleteCalendar = async (calendarId: string): Promise<boolean> => {
    try {
      await Promise.all([
        calendarStorage.deleteCalendar(calendarId),
        calendarStorage.deleteEventsByCalendar(calendarId)
      ]);
      return true;
    } catch (err) {
      setError(`Failed to delete calendar: ${err}`);
      return false;
    }
  };

  const loadEvents = async (): Promise<CalendarEvent[]> => {
    try {
      return await calendarStorage.getEvents();
    } catch (err) {
      setError(`Failed to load events: ${err}`);
      return [];
    }
  };

  const saveEvent = async (event: CalendarEvent): Promise<boolean> => {
    try {
      await calendarStorage.saveEvent(event);
      return true;
    } catch (err) {
      setError(`Failed to save event: ${err}`);
      return false;
    }
  };

  const deleteEvent = async (eventId: string): Promise<boolean> => {
    try {
      await calendarStorage.deleteEvent(eventId);
      return true;
    } catch (err) {
      setError(`Failed to delete event: ${err}`);
      return false;
    }
  };

  const clearAllData = async (): Promise<boolean> => {
    try {
      await calendarStorage.clearAll();
      return true;
    } catch (err) {
      setError(`Failed to clear data: ${err}`);
      return false;
    }
  };

  return {
    isInitialized,
    error,
    loadCalendars,
    saveCalendar,
    deleteCalendar,
    loadEvents,
    saveEvent,
    deleteEvent,
    clearAllData,
    clearError: () => setError(null)
  };
}