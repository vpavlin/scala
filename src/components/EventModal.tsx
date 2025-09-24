import { useState, useEffect } from 'react';
import { Trash2, CalendarIcon, Clock, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { TimeSelector } from './TimeSelector';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

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
  isVisible: boolean;
  isShared?: boolean;
  isPrivate?: boolean;
  shareUrl?: string;
}

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendars: CalendarData[];
  selectedDate: Date | null;
  editingEvent: CalendarEvent | null;
  initialTime?: string;
  preferredCalendarId?: string; // New prop for smart calendar selection
  onEventSave: (event: CalendarEvent | Omit<CalendarEvent, 'id'>) => void;
  onEventDelete?: (eventId: string) => void;
}

export function EventModal({
  isOpen,
  onClose,
  calendars,
  selectedDate,
  editingEvent,
  initialTime,
  preferredCalendarId,
  onEventSave,
  onEventDelete
}: EventModalProps) {
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState<Date | undefined>(undefined);
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [status, setStatus] = useState<'confirmed' | 'tentative' | 'cancelled'>('confirmed');
  const [category, setCategory] = useState('');
  const [url, setUrl] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [reminders, setReminders] = useState<number[]>([15]); // Default 15 minutes
  const [calendarId, setCalendarId] = useState(() => {
    // Smart calendar selection: prefer visible calendars, then any available calendar
    const visibleCalendars = calendars.filter(cal => cal.isVisible);
    if (visibleCalendars.length > 0) {
      return visibleCalendars[0].id;
    }
    return calendars.length > 0 ? calendars[0].id : '';
  });

  useEffect(() => {
    // Only reset form when modal opens/closes or editing event changes
    if (!isOpen) return; // Don't reset when modal is closed
    
    if (editingEvent) {
      setTitle(editingEvent.title);
      setEventDate(new Date(editingEvent.date));
      setAllDay(editingEvent.allDay || false);
      setTime(editingEvent.time || '');
      setEndTime(editingEvent.endTime || '');
      setDescription(editingEvent.description || '');
      setLocation(editingEvent.location || '');
      setAttendees(editingEvent.attendees?.join(', ') || '');
      setPriority(editingEvent.priority || 'medium');
      setStatus(editingEvent.status || 'confirmed');
      setCategory(editingEvent.category || '');
      setUrl(editingEvent.url || '');
      setCustomFields(editingEvent.customFields || {});
      setReminders(editingEvent.reminders || [15]);
      setCalendarId(editingEvent.calendarId);
    } else {
      // Only reset form when opening modal for new event, not on every calendars change
      const wasFormEmpty = !title && !time && !description && !location;
      if (wasFormEmpty || !isOpen) {
        setTitle('');
        setEventDate(selectedDate ? new Date(selectedDate) : new Date());
        setAllDay(false);
        setTime(initialTime || '');
        setEndTime('');
        setDescription('');
        setLocation('');
        setAttendees('');
        setPriority('medium');
        setStatus('confirmed');
        setCategory('');
        setUrl('');
        setCustomFields({});
        setReminders([15]);
        setNewFieldKey('');
        setNewFieldValue('');
        // Smart calendar selection for new events
        const visibleCalendars = calendars.filter(cal => cal.isVisible);
        const defaultCalendarId = preferredCalendarId && calendars.find(cal => cal.id === preferredCalendarId)
          ? preferredCalendarId
          : (visibleCalendars.length > 0 
            ? visibleCalendars[0].id 
            : (calendars.length > 0 ? calendars[0].id : ''));
        setCalendarId(defaultCalendarId);
      }
    }
  }, [editingEvent, isOpen]); // Removed 'calendars' from dependencies to prevent form clearing

  // Separate effect to handle calendar ID when calendars change but preserve other form data
  useEffect(() => {
    if (isOpen && !editingEvent && (!calendarId || !calendars.find(cal => cal.id === calendarId))) {
      // Smart calendar selection when current selection is invalid
      const visibleCalendars = calendars.filter(cal => cal.isVisible);
      const defaultCalendarId = visibleCalendars.length > 0 
        ? visibleCalendars[0].id 
        : (calendars.length > 0 ? calendars[0].id : '');
      setCalendarId(defaultCalendarId);
    }
  }, [calendars, isOpen, editingEvent, calendarId]);

  const resetForm = () => {
    setTitle('');
    setEventDate(selectedDate ? new Date(selectedDate) : new Date());
    setAllDay(false);
    setTime(initialTime || '');
    setEndTime('');
    setDescription('');
    setLocation('');
    setAttendees('');
    setPriority('medium');
    setStatus('confirmed');
    setCategory('');
    setUrl('');
    setCustomFields({});
    setReminders([15]);
    setNewFieldKey('');
    setNewFieldValue('');
    // Smart calendar selection for new events
    const visibleCalendars = calendars.filter(cal => cal.isVisible);
    const defaultCalendarId = preferredCalendarId && calendars.find(cal => cal.id === preferredCalendarId)
      ? preferredCalendarId
      : (visibleCalendars.length > 0 
        ? visibleCalendars[0].id 
        : (calendars.length > 0 ? calendars[0].id : ''));
    setCalendarId(defaultCalendarId);
  };

  const handleSave = () => {
    if (!title.trim() || !eventDate) return;

    const eventData = {
      title: title.trim(),
      date: eventDate,
      allDay: allDay,
      time: allDay ? undefined : (time || undefined),
      endTime: allDay ? undefined : (endTime || undefined),
      calendarId,
      description: description || undefined,
      location: location || undefined,
      attendees: attendees ? attendees.split(',').map(a => a.trim()).filter(a => a) : undefined,
      priority: priority !== 'medium' ? priority : undefined,
      status: status !== 'confirmed' ? status : undefined,
      category: category || undefined,
      url: url || undefined,
      reminders: reminders.length > 0 ? reminders.filter(r => r >= 0) : undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined
    };

    if (editingEvent) {
      onEventSave({ ...eventData, id: editingEvent.id });
    } else {
      onEventSave(eventData);
      // Reset form for new events after saving
      resetForm();
    }

    onClose();
  };

  const addCustomField = () => {
    if (newFieldKey.trim() && newFieldValue.trim()) {
      setCustomFields(prev => ({
        ...prev,
        [newFieldKey.trim()]: newFieldValue.trim()
      }));
      setNewFieldKey('');
      setNewFieldValue('');
    }
  };

  const removeCustomField = (key: string) => {
    setCustomFields(prev => {
      const newFields = { ...prev };
      delete newFields[key];
      return newFields;
    });
  };

  const handleDelete = () => {
    if (editingEvent && onEventDelete) {
      onEventDelete(editingEvent.id);
      onClose();
    }
  };

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return '';
    
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editingEvent ? 'Edit Event' : 'Create New Event'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <Label htmlFor="event-title">Title *</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Event title"
            />
          </div>

          <div>
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !eventDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {eventDate ? format(eventDate, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={eventDate}
                  onSelect={setEventDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="all-day"
              checked={allDay}
              onCheckedChange={(checked) => {
                setAllDay(checked);
                if (checked) {
                  // Clear time values when switching to all-day
                  setTime('');
                  setEndTime('');
                }
              }}
            />
            <Label htmlFor="all-day">All day event</Label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="event-time">Start Time</Label>
                <TimeSelector
                  id="event-time"
                  value={time}
                  onChange={setTime}
                  placeholder="Select start time"
                />
              </div>
              <div>
                <Label htmlFor="event-end-time">End Time</Label>
                <TimeSelector
                  id="event-end-time"
                  value={endTime}
                  onChange={setEndTime}
                  placeholder="Select end time"
                />
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Meeting room, address, or video link"
            />
          </div>

          <div>
            <Label htmlFor="event-attendees">Attendees</Label>
            <Input
              id="event-attendees"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="Comma-separated list of attendees"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="event-priority">Priority</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as 'low' | 'medium' | 'high')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="event-status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as 'confirmed' | 'tentative' | 'cancelled')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="tentative">Tentative</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="event-category">Category</Label>
            <Input
              id="event-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Meeting, Appointment, Personal, etc."
            />
          </div>

          <div>
            <Label htmlFor="event-url">URL</Label>
            <Input
              id="event-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Meeting link, document, or related URL"
            />
          </div>

          <div>
            <Label htmlFor="event-calendar">Calendar *</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((calendar) => (
                  <SelectItem key={calendar.id} value={calendar.id}>
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: calendar.color }}
                      />
                      <span>{calendar.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Event description"
              rows={3}
            />
          </div>

          {/* Reminders Section */}
          <div className="space-y-3">
            <Label>Reminders</Label>
            
            {/* Existing reminders */}
            {reminders.map((minutes, index) => (
              <div key={index} className="flex items-center space-x-2 p-2 bg-muted rounded-md">
                <div className="flex-1">
                  <span className="text-sm">
                    {minutes === 0 ? 'At time of event' :
                     minutes < 60 ? `${minutes} minute${minutes !== 1 ? 's' : ''} before` :
                     minutes < 1440 ? `${Math.floor(minutes / 60)} hour${Math.floor(minutes / 60) !== 1 ? 's' : ''} before` :
                     `${Math.floor(minutes / 1440)} day${Math.floor(minutes / 1440) !== 1 ? 's' : ''} before`}
                  </span>
                </div>
                <Button
                  variant="ghost" 
                  size="sm"
                  onClick={() => setReminders(prev => prev.filter((_, i) => i !== index))}
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {/* Add reminder buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: '5 min', value: 5 },
                { label: '15 min', value: 15 },
                { label: '30 min', value: 30 },
                { label: '1 hour', value: 60 },
                { label: '2 hours', value: 120 },
                { label: '1 day', value: 1440 },
                { label: '1 week', value: 10080 }
              ].map(({ label, value }) => (
                <Button
                  key={value}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!reminders.includes(value)) {
                      setReminders(prev => [...prev, value].sort((a, b) => a - b));
                    }
                  }}
                  disabled={reminders.includes(value)}
                  className="text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Custom Fields Section */}
          <div className="space-y-3">
            <Label>Custom Fields</Label>
            
            {/* Existing custom fields */}
            {Object.entries(customFields).map(([key, value]) => (
              <div key={key} className="flex items-center space-x-2 p-2 bg-muted rounded-md">
                <div className="flex-1">
                  <span className="text-sm font-medium">{key}:</span>
                  <span className="text-sm ml-2">{value}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCustomField(key)}
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}

            {/* Add new custom field */}
            <div className="flex space-x-2">
              <Input
                placeholder="Field name"
                value={newFieldKey}
                onChange={(e) => setNewFieldKey(e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Field value"
                value={newFieldValue}
                onChange={(e) => setNewFieldValue(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={addCustomField}
                disabled={!newFieldKey.trim() || !newFieldValue.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <div>
              {editingEvent && onEventDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Event</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{editingEvent.title}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete Event
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!title.trim()}>
                {editingEvent ? 'Save Changes' : 'Create Event'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}