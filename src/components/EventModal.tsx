import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CalendarEvent {
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
  onEventSave: (event: CalendarEvent | Omit<CalendarEvent, 'id'>) => void;
  onEventDelete?: (eventId: string) => void;
}

export function EventModal({
  isOpen,
  onClose,
  calendars,
  selectedDate,
  editingEvent,
  onEventSave,
  onEventDelete
}: EventModalProps) {
  const [title, setTitle] = useState('');
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
  const [calendarId, setCalendarId] = useState(() => 
    calendars.length > 0 ? calendars[0].id : ''
  );

  useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title);
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
      setCalendarId(editingEvent.calendarId);
    } else {
      setTitle('');
      setTime('');
      setEndTime('');
      setDescription('');
      setLocation('');
      setAttendees('');
      setPriority('medium');
      setStatus('confirmed');
      setCategory('');
      setUrl('');
      setCustomFields({});
      setNewFieldKey('');
      setNewFieldValue('');
      // Set default calendar ID to first available calendar
      setCalendarId(calendars.length > 0 ? calendars[0].id : '');
    }
  }, [editingEvent, isOpen, calendars]);

  const handleSave = () => {
    if (!title.trim() || !selectedDate) return;

    const eventData = {
      title: title.trim(),
      date: selectedDate,
      time: time || undefined,
      endTime: endTime || undefined,
      calendarId,
      description: description || undefined,
      location: location || undefined,
      attendees: attendees ? attendees.split(',').map(a => a.trim()).filter(a => a) : undefined,
      priority: priority !== 'medium' ? priority : undefined,
      status: status !== 'confirmed' ? status : undefined,
      category: category || undefined,
      url: url || undefined,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined
    };

    if (editingEvent) {
      onEventSave({ ...eventData, id: editingEvent.id });
    } else {
      onEventSave(eventData);
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
            <Label>Date</Label>
            <div className="text-sm text-muted-foreground p-2 bg-muted rounded-md">
              {formatDate(selectedDate)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="event-time">Start Time</Label>
              <Input
                id="event-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                step="300"
              />
            </div>
            <div>
              <Label htmlFor="event-end-time">End Time</Label>
              <Input
                id="event-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                step="300"
              />
            </div>
          </div>

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
                <Button
                  variant="outline"
                  onClick={handleDelete}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
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