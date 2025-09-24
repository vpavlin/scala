import { Edit2, X, Trash2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { isValidLocation, openLocationInMap } from '@/lib/locationUtils';

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  time?: string;
  endTime?: string;
  allDay?: boolean;
  calendarId: string;
  description?: string;
  location?: string;
  attendees?: string[];
  priority?: 'low' | 'medium' | 'high';
  status?: 'confirmed' | 'tentative' | 'cancelled';
  category?: string;
  url?: string;
  reminders?: number[];
  customFields?: Record<string, string>;
}

interface CalendarData {
  id: string;
  name: string;
  color: string;
}

interface EventDetailsPanelProps {
  event: CalendarEvent | null;
  calendars: CalendarData[];
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (eventId: string) => void;
}

export function EventDetailsPanel({
  event,
  calendars,
  onClose,
  onEdit,
  onDelete
}: EventDetailsPanelProps) {
  if (!event) return null;

  const calendar = calendars.find(cal => cal.id === event.calendarId);
  
  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return 'No date';
    
    // Ensure we have a proper Date object
    const dateObj = date instanceof Date ? date : new Date(date);
    
    // Check if the date is valid
    if (isNaN(dateObj.getTime())) {
      console.error('Invalid date provided to formatDate:', date);
      return 'Invalid date';
    }
    
    return dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (time: string) => {
    if (!time) return null;
    // Convert to 24h format display
    return time;
  };

  return (
    <div className="fixed inset-0 z-50 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      
      {/* Content container */}
      <div className="fixed bottom-0 left-0 right-0 lg:top-0 lg:right-0 lg:left-auto lg:w-80 bg-card rounded-t-xl lg:rounded-none border-l-0 lg:border-l border-border max-h-[85vh] lg:max-h-none overflow-y-auto shadow-lg lg:shadow-none animate-slide-in-right lg:animate-slide-in-right transform transition-transform duration-300 ease-out">
        {/* Header */}
        <div className="p-4 border-b border-border sticky top-0 bg-card lg:bg-transparent z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Event Details</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center space-x-2 mb-2">
              {calendar && (
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: calendar.color }}
                />
              )}
              <span className="text-sm text-muted-foreground">
                {calendar?.name || 'Unknown Calendar'}
              </span>
            </div>
            <h2 className="text-xl font-semibold mb-3">{event.title}</h2>
          </div>

          <Separator />

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <p className="text-sm">{formatDate(event.date)}</p>
            </div>

            {event.allDay ? (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Duration</label>
                <p className="text-sm">All day</p>
              </div>
            ) : (
              <>
                {event.time && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Start Time</label>
                    <p className="text-sm">{formatTime(event.time)}</p>
                  </div>
                )}

                {event.endTime && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">End Time</label>
                    <p className="text-sm">{formatTime(event.endTime)}</p>
                  </div>
                )}
              </>
            )}

            {event.location && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Location</label>
                {isValidLocation(event.location) ? (
                  <div 
                    className="text-sm text-primary hover:text-primary/80 cursor-pointer flex items-center gap-1 group transition-colors"
                    onClick={() => openLocationInMap(event.location!)}
                    title="Click to open in OpenStreetMap"
                  >
                    <MapPin className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                    <span className="hover:underline">{event.location}</span>
                  </div>
                ) : (
                  <p className="text-sm text-foreground/80">{event.location}</p>
                )}
              </div>
            )}

            {event.attendees && event.attendees.length > 0 && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Attendees</label>
                <div className="text-sm text-foreground/80">
                  {event.attendees.map((attendee, index) => (
                    <span key={index} className="inline-block bg-muted px-2 py-1 rounded mr-1 mb-1">
                      {attendee}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {event.priority && event.priority !== 'medium' && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Priority</label>
                <p className={`text-sm font-medium ${
                  event.priority === 'high' ? 'text-red-600' : 
                  event.priority === 'low' ? 'text-gray-500' : 'text-foreground'
                }`}>
                  {event.priority.charAt(0).toUpperCase() + event.priority.slice(1)}
                </p>
              </div>
            )}

            {event.status && event.status !== 'confirmed' && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <p className={`text-sm font-medium ${
                  event.status === 'cancelled' ? 'text-red-600' : 
                  event.status === 'tentative' ? 'text-yellow-600' : 'text-foreground'
                }`}>
                  {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                </p>
              </div>
            )}

            {event.category && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Category</label>
                <p className="text-sm text-foreground/80">{event.category}</p>
              </div>
            )}

            {event.url && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">URL</label>
                <div className="mt-1">
                  <a 
                    href={event.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline break-all"
                  >
                    {event.url}
                  </a>
                </div>
              </div>
            )}

            {event.description && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">
                  {event.description}
                </p>
              </div>
            )}

            {event.customFields && Object.keys(event.customFields).length > 0 && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Custom Fields</label>
                <div className="space-y-2">
                  {Object.entries(event.customFields).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-start bg-muted p-2 rounded text-sm">
                      <span className="font-medium text-muted-foreground">{key}:</span>
                      <span className="text-foreground/80 text-right ml-2 break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-col sm:flex-row lg:flex-col space-y-2 sm:space-y-0 sm:space-x-2 lg:space-x-0 lg:space-y-2 pb-safe">
            <Button
              variant="outline"
              onClick={() => onEdit(event)}
              className="flex-1 hover-lift"
            >
              <Edit2 className="h-4 w-4 mr-2" />
              Edit Event
            </Button>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive hover-lift"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Event
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Event</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{event.title}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      onDelete(event.id);
                      onClose();
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete Event
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}