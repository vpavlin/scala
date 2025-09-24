import { CalendarEvent } from './wakuSingleNode';

export interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isShared?: boolean;
  isPrivate?: boolean;
  shareUrl?: string;
  description?: string;
  wasUnshared?: boolean; // Indicates a calendar that was previously shared but is no longer active
}

class CalendarStorage {
  private dbName = 'CalendarApp';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create calendars store
        if (!db.objectStoreNames.contains('calendars')) {
          const calendarStore = db.createObjectStore('calendars', { keyPath: 'id' });
          calendarStore.createIndex('name', 'name', { unique: false });
        }

        // Create events store
        if (!db.objectStoreNames.contains('events')) {
          const eventStore = db.createObjectStore('events', { keyPath: 'id' });
          eventStore.createIndex('calendarId', 'calendarId', { unique: false });
          eventStore.createIndex('date', 'date', { unique: false });
        }
      };
    });
  }

  // Calendar operations
  async saveCalendar(calendar: CalendarData): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['calendars'], 'readwrite');
      const store = transaction.objectStore('calendars');
      const request = store.put(calendar);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getCalendars(): Promise<CalendarData[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['calendars'], 'readonly');
      const store = transaction.objectStore('calendars');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['calendars'], 'readwrite');
      const store = transaction.objectStore('calendars');
      const request = store.delete(calendarId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Event operations
  async saveEvent(event: CalendarEvent): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      // Convert Date to string for storage
      const eventToStore = {
        ...event,
        date: event.date.toISOString()
      };
      const request = store.put(eventToStore);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getEvents(): Promise<CalendarEvent[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readonly');
      const store = transaction.objectStore('events');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        // Convert date strings back to Date objects
        const events = (request.result || []).map((event: any) => ({
          ...event,
          date: new Date(event.date)
        }));
        resolve(events);
      };
    });
  }

  async getEventsByCalendar(calendarId: string): Promise<CalendarEvent[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readonly');
      const store = transaction.objectStore('events');
      const index = store.index('calendarId');
      const request = index.getAll(calendarId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = (request.result || []).map((event: any) => ({
          ...event,
          date: new Date(event.date)
        }));
        resolve(events);
      };
    });
  }

  async deleteEvent(eventId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      const request = store.delete(eventId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async deleteEventsByCalendar(calendarId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      const index = store.index('calendarId');
      const request = index.openCursor(calendarId);

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const calendarsPromise = new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['calendars'], 'readwrite');
      const store = transaction.objectStore('calendars');
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    const eventsPromise = new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['events'], 'readwrite');
      const store = transaction.objectStore('events');
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    await Promise.all([calendarsPromise, eventsPromise]);
  }
}

// Singleton instance
export const calendarStorage = new CalendarStorage();