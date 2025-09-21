import { createLightNode, ReliableChannel, HealthStatus } from '@waku/sdk';
import protobuf from 'protobufjs';

export interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  calendarId: string;
  description?: string;
}

export interface EventSourceAction {
  type: 'CREATE_EVENT' | 'UPDATE_EVENT' | 'DELETE_EVENT' | 'SYNC_CALENDAR' | 'SYNC_EVENTS';
  eventId?: string;
  event?: CalendarEvent;
  calendar?: {
    id: string;
    name: string;
    color: string;
    isVisible: boolean;
    isShared?: boolean;
    isPrivate?: boolean;
  };
  events?: CalendarEvent[];
  timestamp: number;
  senderId: string;
}

// Protobuf message structure
const EventActionMessage = new protobuf.Type("EventActionMessage")
  .add(new protobuf.Field("type", 1, "string"))
  .add(new protobuf.Field("eventId", 2, "string"))
  .add(new protobuf.Field("eventData", 3, "string")) // JSON serialized event
  .add(new protobuf.Field("calendarData", 4, "string")) // JSON serialized calendar
  .add(new protobuf.Field("eventsData", 5, "string")) // JSON serialized events array
  .add(new protobuf.Field("timestamp", 6, "uint64"))
  .add(new protobuf.Field("senderId", 7, "string"));

export class WakuCalendarSync {
  private node: any = null;
  private reliableChannel: any = null;
  private isConnected = false;
  private senderId: string;
  private channelId: string;
  private encryptionKey?: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;
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

  constructor(channelId: string, encryptionKey?: string) {
    this.channelId = channelId;
    this.encryptionKey = encryptionKey;
    this.senderId = this.generateSenderId();
  }

  private generateSenderId(): string {
    return `calendar-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public setEventHandlers(handlers: Partial<typeof this.eventHandlers>) {
    this.eventHandlers = { ...this.eventHandlers, ...handlers };
  }

  public async initialize(): Promise<boolean> {
    try {
      console.log('Initializing Waku node...');
      
      // Create Waku node
      this.node = await createLightNode({ defaultBootstrap: true });
      
      // Create content topic for this calendar
      const contentTopic = `/calendar-app/1/${this.channelId}/events`;
      
      // Create encoder and decoder
      const encoder = this.node.createEncoder({ contentTopic });
      const decoder = this.node.createDecoder({ contentTopic });
      
      // Create reliable channel
      this.reliableChannel = await ReliableChannel.create(
        this.node, 
        this.channelId, 
        this.senderId, 
        encoder, 
        decoder
      );
      
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
      
      // Listen for incoming messages
      this.reliableChannel.addEventListener("message-received", (event: any) => {
        this.handleIncomingMessage(event.detail);
      });
      
      // Listen for message events
      this.setupMessageEventListeners();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      console.log('Waku calendar sync initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize Waku:', error);
      this.eventHandlers.onError(`Failed to initialize: ${error}`);
      return false;
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

  private setupMessageEventListeners() {
    this.reliableChannel.addEventListener("sending-message-irrecoverable-error", (event: any) => {
      console.error('Failed to send message:', event.detail.error);
      this.eventHandlers.onError(`Failed to send message: ${event.detail.error}`);
    });

    this.reliableChannel.addEventListener("message-sent", (event: any) => {
      console.log('Message sent successfully:', event.detail);
    });

    this.reliableChannel.addEventListener("message-acknowledged", (event: any) => {
      console.log('Message acknowledged by network:', event.detail);
    });
  }

  private handleIncomingMessage(wakuMessage: any) {
    try {
      console.log('Processing incoming Waku message:', wakuMessage);
      
      const decoded = EventActionMessage.decode(wakuMessage.payload) as any;
      
      // Skip our own messages
      if (decoded.senderId === this.senderId) {
        console.log('Skipping own message');
        return;
      }
      
      const action: EventSourceAction = {
        type: decoded.type as EventSourceAction['type'],
        eventId: decoded.eventId || undefined,
        event: decoded.eventData ? JSON.parse(decoded.eventData) : undefined,
        calendar: decoded.calendarData ? JSON.parse(decoded.calendarData) : undefined,
        events: decoded.eventsData ? JSON.parse(decoded.eventsData) : undefined,
        timestamp: Number(decoded.timestamp),
        senderId: decoded.senderId
      };
      
      // Apply the action
      this.eventHandlers.onEventAction(action);
      
    } catch (error) {
      console.error('Failed to decode incoming message:', error);
      this.eventHandlers.onError(`Failed to decode message: ${error}`);
    }
  }

  public async sendEventAction(action: Omit<EventSourceAction, 'senderId' | 'timestamp'>): Promise<boolean> {
    if (!this.reliableChannel || !this.isConnected) {
      this.eventHandlers.onError('Not connected to Waku network');
      return false;
    }

    try {
      const message = EventActionMessage.create({
        type: action.type,
        eventId: action.eventId || '',
        eventData: action.event ? JSON.stringify(action.event) : '',
        calendarData: action.calendar ? JSON.stringify(action.calendar) : '',
        eventsData: action.events ? JSON.stringify(action.events) : '',
        timestamp: Date.now(),
        senderId: this.senderId
      });

      const serialized = EventActionMessage.encode(message).finish();
      const messageId = this.reliableChannel.send(serialized);
      
      console.log('Sent event action:', action.type, messageId);
      return true;
      
    } catch (error) {
      console.error('Failed to send event action:', error);
      this.eventHandlers.onError(`Failed to send action: ${error}`);
      return false;
    }
  }

  public async createEvent(event: CalendarEvent): Promise<boolean> {
    return this.sendEventAction({
      type: 'CREATE_EVENT',
      eventId: event.id,
      event
    });
  }

  public async updateEvent(event: CalendarEvent): Promise<boolean> {
    return this.sendEventAction({
      type: 'UPDATE_EVENT',
      eventId: event.id,
      event
    });
  }

  public async deleteEvent(eventId: string): Promise<boolean> {
    return this.sendEventAction({
      type: 'DELETE_EVENT',
      eventId
    });
  }

  public async syncCalendar(calendar: any): Promise<boolean> {
    console.log('Syncing calendar metadata:', calendar);
    return this.sendEventAction({
      type: 'SYNC_CALENDAR',
      calendar
    });
  }

  public async syncEvents(events: CalendarEvent[]): Promise<boolean> {
    console.log('Syncing historical events:', events.length, 'events');
    return this.sendEventAction({
      type: 'SYNC_EVENTS',
      events
    });
  }

  public async initializeSharing(calendar: any, events: CalendarEvent[]): Promise<boolean> {
    if (!this.isConnected) {
      this.eventHandlers.onError('Not connected to Waku network');
      return false;
    }

    try {
      console.log('Initializing sharing with historical data...');
      
      // First sync calendar metadata
      await this.syncCalendar(calendar);
      
      // Then sync all historical events for this calendar
      const calendarEvents = events.filter(event => event.calendarId === calendar.id);
      if (calendarEvents.length > 0) {
        await this.syncEvents(calendarEvents);
      }
      
      console.log(`Sharing initialized: synced calendar + ${calendarEvents.length} events`);
      return true;
      
    } catch (error) {
      console.error('Failed to initialize sharing:', error);
      this.eventHandlers.onError(`Failed to initialize sharing: ${error}`);
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
        channelId: this.channelId
      };
    } catch (error) {
      console.error('Failed to get detailed node info:', error);
      return null;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      // Stop health monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      if (this.node) {
        await this.node.stop();
        this.node = null;
        this.reliableChannel = null;
        this.isConnected = false;
        console.log('Waku node disconnected');
      }
    } catch (error) {
      console.error('Error disconnecting Waku node:', error);
    }
  }
}