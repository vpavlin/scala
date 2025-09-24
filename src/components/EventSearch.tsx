import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarEvent } from '@/lib/wakuSingleNode';

interface EventSearchProps {
  events: CalendarEvent[];
  onFilteredEventsChange: (filteredEvents: CalendarEvent[]) => void;
  className?: string;
}

export function EventSearch({ events, onFilteredEventsChange, className }: EventSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredEvents, setFilteredEvents] = useState<CalendarEvent[]>(events);

  // Search function that checks all event fields
  const filterEvents = (term: string, eventList: CalendarEvent[]) => {
    if (!term.trim()) {
      return eventList;
    }

    const searchLower = term.toLowerCase().trim();
    
    return eventList.filter(event => {
      // Search in basic fields
      const titleMatch = event.title?.toLowerCase().includes(searchLower);
      const descriptionMatch = event.description?.toLowerCase().includes(searchLower);
      const locationMatch = event.location?.toLowerCase().includes(searchLower);
      const categoryMatch = event.category?.toLowerCase().includes(searchLower);
      const statusMatch = event.status?.toLowerCase().includes(searchLower);
      const priorityMatch = event.priority?.toLowerCase().includes(searchLower);
      const urlMatch = event.url?.toLowerCase().includes(searchLower);
      
      // Search in attendees
      const attendeesMatch = event.attendees?.some(attendee => 
        attendee.toLowerCase().includes(searchLower)
      );
      
      // Search in custom metadata
      const metadataMatch = event.customFields && Object.entries(event.customFields).some(([key, value]) =>
        key.toLowerCase().includes(searchLower) || 
        (typeof value === 'string' && value.toLowerCase().includes(searchLower))
      );

      return titleMatch || descriptionMatch || locationMatch || categoryMatch || 
             statusMatch || priorityMatch || urlMatch || attendeesMatch || metadataMatch;
    });
  };

  // Update filtered events when search term or events change
  useEffect(() => {
    const filtered = filterEvents(searchTerm, events);
    setFilteredEvents(filtered);
    onFilteredEventsChange(filtered);
  }, [searchTerm, events, onFilteredEventsChange]);

  const clearSearch = () => {
    setSearchTerm('');
  };

  const hasActiveSearch = searchTerm.trim().length > 0;
  const resultCount = filteredEvents.length;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search events by title, location, attendees, metadata..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 pr-10"
        />
        {hasActiveSearch && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearSearch}
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0 hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {hasActiveSearch && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </Badge>
          <span>for "{searchTerm}"</span>
        </div>
      )}
    </div>
  );
}