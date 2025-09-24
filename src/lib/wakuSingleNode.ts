import { createLightNode, ReliableChannel, HealthStatus } from '@waku/sdk';
import protobuf from 'protobufjs';

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  endTime?: string;
  calendarId: string;
  description?: string;
  location?: string;
  attendees?: string[];
  priority?: 'low' | 'medium' | 'high';
  status?: 'confirmed' | 'tentative' | 'cancelled';
  category?: string;
  url?: string;
  reminders?: number[]; // minutes before event
  customFields?: Record<string, string>; // key/value pairs for custom metadata
}

export interface EventSourceAction {
  type: 'CREATE_EVENT' | 'UPDATE_EVENT' | 'DELETE_EVENT' | 'SYNC_EVENTS' | 'SYNC_CALENDAR_DESCRIPTION' | 'UNSHARE_CALENDAR';
  eventId?: string;
  event?: CalendarEvent;
  events?: CalendarEvent[];
  calendarId?: string;
  description?: string;
  calendarName?: string; // For unshare notifications
  timestamp: number;
  senderId: string;
}

// Protobuf message structure - events and calendar description
const EventActionMessage = new protobuf.Type("EventActionMessage")
  .add(new protobuf.Field("type", 1, "string"))
  .add(new protobuf.Field("eventId", 2, "string"))
  .add(new protobuf.Field("eventData", 3, "string")) // JSON serialized event
  .add(new protobuf.Field("eventsData", 5, "string")) // JSON serialized events array
  .add(new protobuf.Field("timestamp", 6, "uint64"))
  .add(new protobuf.Field("senderId", 7, "string"))
  .add(new protobuf.Field("calendarId", 8, "string"))
  .add(new protobuf.Field("description", 9, "string"))
  .add(new protobuf.Field("calendarName", 10, "string")); // For unshare notifications

interface CalendarChannel {
  calendarId: string;
  encryptionKey?: string;
  reliableChannel: any;
  encoder: any;
  decoder: any;
}

export class WakuSingleNodeManager {
  private node: any = null;
  private channels: Map<string, CalendarChannel> = new Map();
  private isConnected = false;
  private senderId: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Message tracking for incremental sync
  private processedMessageIds: Set<string> = new Set();
  private lastProcessedTimestamp: Map<string, number> = new Map(); // per calendar
  private maxProcessedMessages = 10000; // Limit memory usage
  private nodeStats = {
    peerCount: 0,
    isHealthy: false,
    protocolsSupported: [] as string[],
    startTime: Date.now()
  };
  
  private eventHandlers: {
    onEventAction: (action: EventSourceAction) => void;
    onConnectionStatus: (status: 'connected' | 'disconnected' | 'minimal') => void;
    onError: (error: string) => void;
    onNodeStats?: (stats: typeof this.nodeStats) => void;
  } = {
    onEventAction: () => {},
    onConnectionStatus: () => {},
    onError: () => {}
  };

  constructor() {
    this.senderId = this.generateSenderId();
  }

  private generateSenderId(): string {
    return `calendar-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public setEventHandlers(handlers: Partial<typeof this.eventHandlers>) {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  public async initialize(): Promise<boolean> {
    if (this.node) {
      console.log('Waku node already initialized');
      return true;
    }

    try {
      console.log('Initializing single Waku node...');
      
      // Create Waku node
      this.node = await createLightNode({ defaultBootstrap: true });
      
      // Listen for connection status
      this.node.events.addEventListener("waku:health", (event: any) => {
        const health = event.detail;
        
        if (health === HealthStatus.SufficientlyHealthy) {
          this.isConnected = true;
          this.eventHandlers.onConnectionStatus('connected');
        } else if (health === HealthStatus.MinimallyHealthy) {
          this.isConnected = true;
          this.eventHandlers.onConnectionStatus('minimal');
        } else {
          this.isConnected = false;
          this.eventHandlers.onConnectionStatus('disconnected');
        }
      });
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      console.log('Single Waku node initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize Waku node:', error);
      this.eventHandlers.onError(`Failed to initialize: ${error}`);
      return false;
    }
  }

  public async addCalendarChannel(calendarId: string, encryptionKey?: string): Promise<boolean> {
    if (!this.node) {
      this.eventHandlers.onError('Waku node not initialized');
      return false;
    }

    if (this.channels.has(calendarId)) {
      console.log(`Calendar ${calendarId} already has a channel`);
      return true;
    }

    try {
      console.log(`Adding calendar channel for: ${calendarId}`);
      
      // Create content topic for this calendar
      const contentTopic = `/calendar-app/1/${calendarId}/events`;
      
      // Create encoder and decoder
      const encoder = this.node.createEncoder({ contentTopic });
      const decoder = this.node.createDecoder({ contentTopic });
      
      // Create reliable channel
      const reliableChannel = await ReliableChannel.create(
        this.node, 
        calendarId, 
        this.senderId, 
        encoder, 
        decoder
      );
      
      // Listen for incoming messages on this channel
      reliableChannel.addEventListener("message-received", (event: any) => {
        this.handleIncomingMessage(event.detail, calendarId);
      });
      
      // Listen for message events
      this.setupChannelEventListeners(reliableChannel, calendarId);
      
      // Store the channel
      const channel: CalendarChannel = {
        calendarId,
        encryptionKey,
        reliableChannel,
        encoder,
        decoder
      };
      
      this.channels.set(calendarId, channel);
      console.log(`Calendar channel added for: ${calendarId}`);
      
      return true;
      
    } catch (error) {
      console.error(`Failed to add calendar channel for ${calendarId}:`, error);
      this.eventHandlers.onError(`Failed to add channel for calendar: ${error}`);
      return false;
    }
  }

  public async removeCalendarChannel(calendarId: string): Promise<void> {
    const channel = this.channels.get(calendarId);
    if (channel) {
      // Note: ReliableChannel doesn't have a direct close method, but removing from our map
      // and letting it go out of scope should be sufficient
      this.channels.delete(calendarId);
      console.log(`Removed calendar channel for: ${calendarId}`);
    }
  }

  private startHealthMonitoring() {
    // Initial stats collection
    this.updateNodeStats();
    
    // Set up periodic health checks every 10 seconds
    this.healthCheckInterval = setInterval(() => {
      this.updateNodeStats();
    }, 10000);
  }

  private async updateNodeStats() {
    if (!this.node) return;

    try {
      // Get peer count
      const peers = await this.node.libp2p?.getPeers() || [];
      
      // Get supported protocols
      const protocols = this.node.libp2p?.getProtocols() || [];
      
      // Update stats
      this.nodeStats = {
        peerCount: peers.length,
        isHealthy: this.isConnected && peers.length > 0,
        protocolsSupported: protocols,
        startTime: this.nodeStats.startTime
      };

      // Notify listeners
      this.eventHandlers.onNodeStats?.(this.nodeStats);
      
      console.log('Waku node stats:', this.nodeStats);
    } catch (error) {
      console.warn('Failed to update node stats:', error);
    }
  }

  private setupChannelEventListeners(reliableChannel: any, calendarId: string) {
    reliableChannel.addEventListener("sending-message-irrecoverable-error", (event: any) => {
      console.error(`Failed to send message for calendar ${calendarId}:`, event.detail.error);
      this.eventHandlers.onError(`Failed to send message for calendar ${calendarId}: ${event.detail.error}`);
    });

    reliableChannel.addEventListener("message-sent", (event: any) => {
      console.log(`Message sent successfully for calendar ${calendarId}:`, event.detail);
    });

    reliableChannel.addEventListener("message-acknowledged", (event: any) => {
      console.log(`Message acknowledged by network for calendar ${calendarId}:`, event.detail);
    });
  }

  private handleIncomingMessage(wakuMessage: any, calendarId: string) {
    try {
      console.log(`Processing incoming Waku message for calendar ${calendarId}:`, wakuMessage);
      
      const decoded = EventActionMessage.decode(wakuMessage.payload) as any;
      
      // Skip our own messages
      if (decoded.senderId === this.senderId) {
        console.log('Skipping own message');
        return;
      }
      
      // Create unique message ID from senderId + timestamp + type + eventId
      const messageId = `${decoded.senderId}-${decoded.timestamp}-${decoded.type}-${decoded.eventId || 'no-event'}`;
      
      // Skip already processed messages
      if (this.processedMessageIds.has(messageId)) {
        console.log(`Skipping already processed message: ${messageId}`);
        return;
      }
      
      // Check if this message is older than our last processed timestamp for this calendar
      const lastTimestamp = this.lastProcessedTimestamp.get(calendarId) || 0;
      if (decoded.timestamp <= lastTimestamp && decoded.type !== 'SYNC_EVENTS') {
        console.log(`Skipping old message (timestamp: ${decoded.timestamp}, last: ${lastTimestamp})`);
        return;
      }
      
      const action: EventSourceAction = {
        type: decoded.type as EventSourceAction['type'],
        eventId: decoded.eventId || undefined,
        event: decoded.eventData ? this.parseEventData(decoded.eventData) : undefined,
        events: decoded.eventsData ? this.parseEventsData(decoded.eventsData) : undefined,
        calendarId: decoded.calendarId || undefined,
        description: decoded.description || undefined,
        calendarName: decoded.calendarName || undefined,
        timestamp: Number(decoded.timestamp),
        senderId: decoded.senderId
      };
      
      // Mark message as processed
      this.processedMessageIds.add(messageId);
      
      // Update last processed timestamp for incremental operations
      if (decoded.type === 'CREATE_EVENT' || decoded.type === 'UPDATE_EVENT' || decoded.type === 'DELETE_EVENT') {
        const currentLast = this.lastProcessedTimestamp.get(calendarId) || 0;
        if (decoded.timestamp > currentLast) {
          this.lastProcessedTimestamp.set(calendarId, decoded.timestamp);
        }
      }
      
      // Cleanup old message IDs periodically to prevent memory leaks
      if (this.processedMessageIds.size > this.maxProcessedMessages) {
        const idsArray = Array.from(this.processedMessageIds);
        const toRemove = idsArray.slice(0, Math.floor(this.maxProcessedMessages * 0.3));
        toRemove.forEach(id => this.processedMessageIds.delete(id));
        console.log(`Cleaned up ${toRemove.length} old message IDs`);
      }
      
      // Apply the action
      this.eventHandlers.onEventAction(action);
      
    } catch (error) {
      console.error(`Failed to decode incoming message for calendar ${calendarId}:`, error);
      this.eventHandlers.onError(`Failed to decode message for calendar ${calendarId}: ${error}`);
    }
  }

  // Helper method to parse event data and convert date strings to Date objects
  private parseEventData(eventDataString: string): CalendarEvent {
    try {
      const parsed = JSON.parse(eventDataString);
      return {
        ...parsed,
        date: new Date(parsed.date) // Convert date string back to Date object
      };
    } catch (error) {
      console.error('Failed to parse event data:', error);
      throw error;
    }
  }

  // Helper method to parse events array and convert date strings to Date objects
  private parseEventsData(eventsDataString: string): CalendarEvent[] {
    try {
      const parsed = JSON.parse(eventsDataString);
      return parsed.map((event: any) => ({
        ...event,
        date: new Date(event.date) // Convert date string back to Date object
      }));
    } catch (error) {
      console.error('Failed to parse events data:', error);
      throw error;
    }
  }

  public async sendEventAction(calendarId: string, action: Omit<EventSourceAction, 'senderId' | 'timestamp'>): Promise<boolean> {
    const channel = this.channels.get(calendarId);
    if (!channel || !this.isConnected) {
      this.eventHandlers.onError(`Not connected to Waku network or channel not found for calendar ${calendarId}`);
      return false;
    }

    try {
      const message = EventActionMessage.create({
        type: action.type,
        eventId: action.eventId || '',
        eventData: action.event ? JSON.stringify(action.event) : '',
        eventsData: action.events ? JSON.stringify(action.events) : '',
        calendarId: action.calendarId || '',
        description: action.description || '',
        timestamp: Date.now(),
        senderId: this.senderId
      });

      const serialized = EventActionMessage.encode(message).finish();
      const messageId = channel.reliableChannel.send(serialized);
      
      console.log(`Sent event action for calendar ${calendarId}:`, action.type, messageId);
      return true;
      
    } catch (error) {
      console.error(`Failed to send event action for calendar ${calendarId}:`, error);
      this.eventHandlers.onError(`Failed to send action for calendar ${calendarId}: ${error}`);
      return false;
    }
  }

  public async createEvent(calendarId: string, event: CalendarEvent): Promise<boolean> {
    return this.sendEventAction(calendarId, {
      type: 'CREATE_EVENT',
      eventId: event.id,
      event
    });
  }

  public async updateEvent(calendarId: string, event: CalendarEvent): Promise<boolean> {
    return this.sendEventAction(calendarId, {
      type: 'UPDATE_EVENT',
      eventId: event.id,
      event
    });
  }

  public async deleteEvent(calendarId: string, eventId: string): Promise<boolean> {
    return this.sendEventAction(calendarId, {
      type: 'DELETE_EVENT',
      eventId
    });
  }

  // Removed syncCalendar - we no longer sync calendar metadata
  // Only events are synced, allowing users to customize calendar names/colors locally

  public async syncEvents(calendarId: string, events: CalendarEvent[]): Promise<boolean> {
    console.log(`Syncing historical events for ${calendarId}:`, events.length, 'events');
    return this.sendEventAction(calendarId, {
      type: 'SYNC_EVENTS',
      events
    });
  }

  public async syncCalendarDescription(calendarId: string, description: string): Promise<boolean> {
    return this.sendEventAction(calendarId, {
      type: 'SYNC_CALENDAR_DESCRIPTION',
      calendarId,
      description
    });
  }

  public async unshareCalendar(calendarId: string, calendarName: string): Promise<boolean> {
    return this.sendEventAction(calendarId, {
      type: 'UNSHARE_CALENDAR',
      calendarId,
      calendarName
    });
  }

  public async initializeSharing(calendarId: string, calendar: any, events: CalendarEvent[], forceFullSync: boolean = false): Promise<boolean> {
    if (!this.isConnected) {
      this.eventHandlers.onError('Not connected to Waku network');
      return false;
    }

    try {
      console.log(`Initializing sharing for calendar ${calendarId} - syncing events and description...`);
      
      const calendarEvents = events.filter(event => event.calendarId === calendarId);
      
      // Always sync the calendar description when initializing sharing
      if (calendar.description) {
        await this.syncCalendarDescription(calendarId, calendar.description);
      }
      
      if (forceFullSync || !this.lastProcessedTimestamp.has(calendarId)) {
        // Full sync needed - send all events
        console.log(`Performing full sync for calendar ${calendarId} with ${calendarEvents.length} events`);
        if (calendarEvents.length > 0) {
          await this.syncEvents(calendarId, calendarEvents);
        }
      } else {
        // Incremental sync - only send events newer than last processed
        const lastTimestamp = this.lastProcessedTimestamp.get(calendarId) || 0;
        const newEvents = calendarEvents.filter(event => new Date(event.date).getTime() > lastTimestamp);
        
        if (newEvents.length > 0) {
          console.log(`Performing incremental sync for calendar ${calendarId} with ${newEvents.length} new events`);
          await this.syncEvents(calendarId, newEvents);
        } else {
          console.log(`No new events to sync for calendar ${calendarId}`);
        }
      }
      
      console.log(`Sharing initialized for calendar ${calendarId}`);
      return true;
      
    } catch (error) {
      console.error(`Failed to initialize sharing for calendar ${calendarId}:`, error);
      this.eventHandlers.onError(`Failed to initialize sharing for calendar ${calendarId}: ${error}`);
      return false;
    }
  }

  public generateShareUrl(calendarId: string, calendarName: string, encryptionKey?: string): string {
    const baseUrl = window.location.origin;
    const params = new URLSearchParams({
      calendar: calendarId,
      name: encodeURIComponent(calendarName)
    });
    
    if (encryptionKey) {
      params.set('key', encryptionKey);
    }
    
    return `${baseUrl}/shared?${params.toString()}`;
  }

  public static parseShareUrl(url: string): { calendarId: string; calendarName: string; encryptionKey?: string } | null {
    try {
      const urlObj = new URL(url);
      const calendarId = urlObj.searchParams.get('calendar');
      const calendarName = urlObj.searchParams.get('name');
      const encryptionKey = urlObj.searchParams.get('key') || undefined;
      
      if (!calendarId || !calendarName) {
        return null;
      }
      
      return { 
        calendarId, 
        calendarName: decodeURIComponent(calendarName), 
        encryptionKey 
      };
    } catch {
      return null;
    }
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  public getNodeStats() {
    return { ...this.nodeStats };
  }

  public getChannelCount(): number {
    return this.channels.size;
  }

  public getChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }

  public async getDetailedNodeInfo() {
    if (!this.node) return null;

    try {
      const peers = await this.node.libp2p?.getPeers() || [];
      const protocols = this.node.libp2p?.getProtocols() || [];
      const connections = this.node.libp2p?.getConnections() || [];
      
      return {
        peerId: this.node.libp2p?.peerId?.toString() || 'Unknown',
        peerCount: peers.length,
        connectedPeers: peers.map((peer: any) => peer.toString()),
        protocols: protocols,
        connectionCount: connections.length,
        uptime: Date.now() - this.nodeStats.startTime,
        isConnected: this.isConnected,
        channelCount: this.channels.size,
        channels: Array.from(this.channels.keys())
      };
    } catch (error) {
      console.error('Failed to get detailed node info:', error);
      return null;
    }
  }

  // Method to check if incremental sync is possible
  public canUseIncrementalSync(calendarId: string): boolean {
    return this.lastProcessedTimestamp.has(calendarId);
  }
  
  // Method to get last processed timestamp for a calendar
  public getLastProcessedTimestamp(calendarId: string): number {
    return this.lastProcessedTimestamp.get(calendarId) || 0;
  }
  
  // Method to reset sync state for a calendar (force full sync next time)
  public resetSyncState(calendarId: string): void {
    this.lastProcessedTimestamp.delete(calendarId);
    console.log(`Reset sync state for calendar ${calendarId}`);
  }

  public async disconnect(): Promise<void> {
    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      // Clear all channels
      this.channels.clear();
      
      // Clear sync state
      this.processedMessageIds.clear();
      this.lastProcessedTimestamp.clear();
      
      if (this.node) {
        await this.node.stop();
        this.node = null;
        this.isConnected = false;
        console.log('Waku node disconnected');
      }
    } catch (error) {
      console.error('Error disconnecting Waku node:', error);
    }
  }
}