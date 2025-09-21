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
  calendarId: string;
  description?: string;
}

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  editingEvent: CalendarEvent | null;
  onEventSave: (event: CalendarEvent | Omit<CalendarEvent, 'id'>) => void;
  onEventDelete?: (eventId: string) => void;
}

export function EventModal({
  isOpen,
  onClose,
  selectedDate,
  editingEvent,
  onEventSave,
  onEventDelete
}: EventModalProps) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [calendarId, setCalendarId] = useState('default');

  // Mock calendars - in real app this would come from props
  const mockCalendars = [
    { id: 'default', name: 'Personal', color: '#10b981' },
    { id: 'work', name: 'Work', color: '#3b82f6' },
    { id: 'family', name: 'Family', color: '#f59e0b' }
  ];

  useEffect(() => {
    if (editingEvent) {
      setTitle(editingEvent.title);
      setTime(editingEvent.time || '');
      setDescription(editingEvent.description || '');
      setCalendarId(editingEvent.calendarId);
    } else {
      setTitle('');
      setTime('');
      setDescription('');
      setCalendarId('default');
    }
  }, [editingEvent, isOpen]);

  const handleSave = () => {
    if (!title.trim() || !selectedDate) return;

    const eventData = {
      title: title.trim(),
      date: selectedDate,
      time: time || undefined,
      calendarId,
      description: description || undefined
    };

    if (editingEvent) {
      onEventSave({ ...eventData, id: editingEvent.id });
    } else {
      onEventSave(eventData);
    }

    onClose();
  };

  const handleDelete = () => {
    if (editingEvent && onEventDelete) {
      onEventDelete(editingEvent.id);
      onClose();
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingEvent ? 'Edit Event' : 'Create New Event'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="event-title">Title</Label>
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

          <div>
            <Label htmlFor="event-time">Time (optional)</Label>
            <Input
              id="event-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="event-calendar">Calendar</Label>
            <Select value={calendarId} onValueChange={setCalendarId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mockCalendars.map((calendar) => (
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
            <Label htmlFor="event-description">Description (optional)</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Event description"
              rows={3}
            />
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