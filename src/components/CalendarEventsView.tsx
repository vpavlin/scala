import { ArrowLeft, Calendar as CalendarIcon, Clock, Plus, MapPin, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EventsMap } from './EventsMap';
import { useState, useMemo } from 'react';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  allDay?: boolean;
  calendarId: string;
  description?: string;
  location?: string;
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  description?: string;
}

interface CalendarEventsViewProps {
  calendar: CalendarData;
  calendars: CalendarData[]; // Add all calendars for map component
  events: CalendarEvent[];
  onBack: () => void;
  onEventClick: (event: CalendarEvent) => void;
  onNewEventRequest: (date: Date, calendarId: string) => void;
}

export function CalendarEventsView({ 
  calendar, 
  calendars,
  events, 
  onBack, 
  onEventClick,
  onNewEventRequest 
}: CalendarEventsViewProps) {
  const [showMap, setShowMap] = useState(false);
  
  const calendarEvents = useMemo(() => 
    events
      .filter(event => event.calendarId === calendar.id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [events, calendar.id]
  );

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const isToday = (date: Date) => {
    const today = new Date();
    const eventDate = new Date(date);
    return eventDate.toDateString() === today.toDateString();
  };

  const isPast = (date: Date) => {
    const today = new Date();
    const eventDate = new Date(date);
    today.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate < today;
  };

  const groupEventsByDate = () => {
    const grouped: Record<string, CalendarEvent[]> = {};
    calendarEvents.forEach(event => {
      const dateKey = new Date(event.date).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(event);
    });
    return grouped;
  };

  const groupedEvents = groupEventsByDate();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={onBack}
          className="shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div 
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: calendar.color }}
            />
            <h1 className="text-2xl font-semibold truncate">{calendar.name}</h1>
          </div>
          
          {calendar.description && (
            <p className="text-muted-foreground mt-1">{calendar.description}</p>
          )}
          
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <CalendarIcon className="h-4 w-4" />
              <span>{calendarEvents.length} events</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <List className="h-4 w-4" />
            <Switch
              checked={showMap}
              onCheckedChange={setShowMap}
              id="map-toggle"
            />
            <MapPin className="h-4 w-4" />
            <Label htmlFor="map-toggle" className="text-sm">
              Map
            </Label>
          </div>
          
          <Button
            className="hover-lift shrink-0"
            onClick={() => onNewEventRequest(new Date(), calendar.id)}
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">New Event</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      {/* Events List or Map */}
      <div className="space-y-6">
        {showMap ? (
          <EventsMap 
            events={calendarEvents} 
            calendars={calendars}
            onEventClick={onEventClick}
          />
        ) : (
          calendarEvents.length === 0 ? (
            <Card className="p-8 text-center">
              <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No events yet</h3>
              <p className="text-muted-foreground">
                This calendar doesn&apos;t have any events. Create your first event to get started.
              </p>
            </Card>
          ) : (
            Object.entries(groupedEvents).map(([dateKey, dayEvents]) => {
              const date = new Date(dateKey);
              const isDateToday = isToday(date);
              const isDatePast = isPast(date);
              
              return (
                <div key={dateKey} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className={`text-lg font-medium ${
                      isDateToday ? 'text-accent' : isDatePast ? 'text-muted-foreground' : ''
                    }`}>
                      {formatDate(date)}
                    </h3>
                    {isDateToday && (
                      <Badge variant="secondary" className="text-xs">Today</Badge>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    {dayEvents.map(event => (
                      <Card 
                        key={event.id}
                        className={`p-4 cursor-pointer hover-lift transition-all ${
                          isDatePast ? 'opacity-60' : ''
                        }`}
                        style={{
                          backgroundColor: `${calendar.color}08`,
                          borderColor: `${calendar.color}20`
                        }}
                        onClick={() => onEventClick(event)}
                        title={`${event.title}${event.location ? ` • ${event.location}` : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <div 
                            className="w-3 h-3 rounded-full mt-1 shrink-0"
                            style={{ backgroundColor: calendar.color }}
                          />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium truncate">{event.title}</h4>
                              {event.allDay ? (
                                <div className="text-sm text-muted-foreground shrink-0">
                                  All day
                                </div>
                              ) : event.time && (
                                <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                                  <Clock className="h-3 w-3" />
                                  <span>{event.time}</span>
                                </div>
                              )}
                            </div>
                            
                            {event.location && (
                              <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate">{event.location}</span>
                              </div>
                            )}
                            
                            {event.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {event.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })
          )
        )}
      </div>
    </div>
  );
}