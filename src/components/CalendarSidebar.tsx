import { useState } from 'react';
import { Plus, Share2, Eye, EyeOff, MoreHorizontal, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ShareCalendarModal } from '@/components/ShareCalendarModal';
import { WakuStatus } from '@/components/WakuStatus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';

interface CalendarData {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isShared?: boolean;
  isPrivate?: boolean;
  shareUrl?: string;
}

interface CalendarSidebarProps {
  calendars: CalendarData[];
  selectedCalendars: string[];
  onCalendarToggle: (calendarId: string) => void;
  onCalendarCreate: (calendar: Omit<CalendarData, 'id'>) => void;
  onCalendarEdit: (calendar: CalendarData) => void;
  onCalendarDelete: (calendarId: string) => void;
  onCalendarShare: (calendarId: string, isPrivate: boolean) => void;
  connectionStatus?: 'connected' | 'disconnected' | 'minimal';
  isWakuConnected?: boolean;
  connectionStats?: {
    totalConnections: number;
    connectedCount: number;
    connections: {
      calendarId: string;
      isConnected: boolean;
      status: 'disconnected' | 'connected' | 'minimal';
    }[];
  };
}

export function CalendarSidebar({
  calendars,
  selectedCalendars,
  onCalendarToggle,
  onCalendarCreate,
  onCalendarEdit,
  onCalendarDelete,
  onCalendarShare,
  connectionStatus = 'disconnected',
  isWakuConnected = false,
  connectionStats
}: CalendarSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<CalendarData | null>(null);
  const [sharingCalendar, setSharingCalendar] = useState<CalendarData | null>(null);
  const [newCalendarName, setNewCalendarName] = useState('');

  const handleCreateCalendar = () => {
    if (newCalendarName.trim()) {
      onCalendarCreate({
        name: newCalendarName.trim(),
        color: '#10b981', // emerald-500
        isVisible: true
      });
      setNewCalendarName('');
      setIsCreateDialogOpen(false);
      toast({
        title: "Calendar created",
        description: `"${newCalendarName.trim()}" has been created successfully.`
      });
    }
  };

  const handleEditCalendar = () => {
    if (editingCalendar && newCalendarName.trim()) {
      onCalendarEdit({
        ...editingCalendar,
        name: newCalendarName.trim()
      });
      setNewCalendarName('');
      setIsEditDialogOpen(false);
      setEditingCalendar(null);
      toast({
        title: "Calendar updated",
        description: `Calendar has been updated successfully.`
      });
    }
  };

  const handleShare = (calendar: CalendarData) => {
    setSharingCalendar(calendar);
    setIsShareDialogOpen(true);
  };

  const handleShareConfirm = (calendarId: string, isPrivate: boolean) => {
    onCalendarShare(calendarId, isPrivate);
    setIsShareDialogOpen(false);
    setSharingCalendar(null);
  };

  const handleDelete = (calendar: CalendarData) => {
    onCalendarDelete(calendar.id);
    toast({
      title: "Calendar deleted",
      description: `"${calendar.name}" has been deleted.`
    });
  };

  return (
    <div className="w-80 border-r border-border bg-card p-4 sidebar-transition">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Calendars</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="hover-lift">
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Calendar</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="calendar-name">Calendar Name</Label>
                <Input
                  id="calendar-name"
                  value={newCalendarName}
                  onChange={(e) => setNewCalendarName(e.target.value)}
                  placeholder="Enter calendar name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateCalendar();
                    }
                  }}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateCalendar} disabled={!newCalendarName.trim()}>
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {calendars.map((calendar) => (
          <Card key={calendar.id} className="p-3 hover-lift">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 flex-1">
                <Checkbox
                  checked={selectedCalendars.includes(calendar.id)}
                  onCheckedChange={() => onCalendarToggle(calendar.id)}
                />
                <div className="flex items-center space-x-2 flex-1">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <span className="text-sm font-medium truncate">{calendar.name}</span>
                </div>
              </div>
              
              <div className="flex items-center space-x-1">
                {calendar.isShared && (
                  <Share2 className="h-3 w-3 text-accent" />
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                      <MoreHorizontal className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => {
                      setEditingCalendar(calendar);
                      setNewCalendarName(calendar.name);
                      setIsEditDialogOpen(true);
                    }}>
                      <Edit2 className="h-3 w-3 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleShare(calendar)}>
                      <Share2 className="h-3 w-3 mr-2" />
                      Share
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => handleDelete(calendar)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-3 w-3 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Calendar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-calendar-name">Calendar Name</Label>
              <Input
                id="edit-calendar-name"
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                placeholder="Enter calendar name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleEditCalendar();
                  }
                }}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleEditCalendar} disabled={!newCalendarName.trim()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Calendar</DialogTitle>
          </DialogHeader>
          {sharingCalendar && (
            <ShareCalendarModal
              calendarId={sharingCalendar.id}
              calendarName={sharingCalendar.name}
              isPrivate={sharingCalendar.isPrivate || false}
              onPrivateToggle={(isPrivate) => {
                setSharingCalendar(prev => prev ? { ...prev, isPrivate } : null);
              }}
              connectionStatus={connectionStatus}
              isConnected={isWakuConnected}
              onInitializeWaku={(calendarId, encryptionKey) => {
                handleShareConfirm(calendarId, !!encryptionKey);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
        
        {/* Waku Network Status */}
        <WakuStatus
          connectionStatus={connectionStatus}
          isConnected={isWakuConnected}
          connectionStats={connectionStats}
        />
      </div>
  );
}