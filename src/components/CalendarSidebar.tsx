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
  eventCounts: Record<string, number>;
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
  eventCounts,
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
  const [newCalendarColor, setNewCalendarColor] = useState('#10b981');

  // Predefined color palette
  const colorPalette = [
    '#10b981', // emerald
    '#3b82f6', // blue
    '#8b5cf6', // purple
    '#f59e0b', // amber
    '#ef4444', // red
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#ec4899', // pink
    '#6366f1', // indigo
    '#14b8a6', // teal
    '#a855f7'  // violet
  ];

  // Get available colors (not used by other calendars)
  const getAvailableColors = (excludeCalendarId?: string) => {
    const usedColors = calendars
      .filter(cal => cal.id !== excludeCalendarId)
      .map(cal => cal.color);
    return colorPalette.filter(color => !usedColors.includes(color));
  };

  const handleCreateCalendar = () => {
    if (newCalendarName.trim()) {
      const availableColors = getAvailableColors();
      const selectedColor = availableColors.includes(newCalendarColor) 
        ? newCalendarColor 
        : availableColors[0] || colorPalette[0];
        
      onCalendarCreate({
        name: newCalendarName.trim(),
        color: selectedColor,
        isVisible: true
      });
      setNewCalendarName('');
      setNewCalendarColor('#10b981');
      setIsCreateDialogOpen(false);
      toast({
        title: "Calendar created",
        description: `"${newCalendarName.trim()}" has been created successfully.`
      });
    }
  };

  const handleEditCalendar = () => {
    if (editingCalendar && newCalendarName.trim()) {
      const availableColors = getAvailableColors(editingCalendar.id);
      const selectedColor = availableColors.includes(newCalendarColor) 
        ? newCalendarColor 
        : editingCalendar.color; // Keep current color if new one is unavailable
        
      onCalendarEdit({
        ...editingCalendar,
        name: newCalendarName.trim(),
        color: selectedColor
      });
      setNewCalendarName('');
      setNewCalendarColor('#10b981');
      setIsEditDialogOpen(false);
      setEditingCalendar(null);
      toast({
        title: "Calendar updated",
        description: "Calendar has been updated successfully."
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
              <div>
                <Label>Calendar Color</Label>
                <div className="grid grid-cols-6 gap-2 mt-2">
                  {getAvailableColors().map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        newCalendarColor === color 
                          ? 'border-foreground shadow-md scale-110' 
                          : 'border-border hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewCalendarColor(color)}
                    />
                  ))}
                </div>
                {getAvailableColors().length === 0 && (
                  <p className="text-sm text-muted-foreground mt-2">All colors are in use</p>
                )}
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleCreateCalendar} 
                  disabled={!newCalendarName.trim() || getAvailableColors().length === 0}
                >
                  Create
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {/* Private Calendars */}
        {calendars.filter(cal => !cal.isShared).length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground px-1">Private Calendars</h3>
            <div className="space-y-2">
              {calendars.filter(cal => !cal.isShared).map((calendar) => (
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
                        {eventCounts[calendar.id] > 0 && (
                          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full ml-auto">
                            {eventCounts[calendar.id]}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1">
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
                            setNewCalendarColor(calendar.color);
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
          </div>
        )}

        {/* Shared Calendars */}
        {calendars.filter(cal => cal.isShared).length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground px-1">Shared Calendars</h3>
            <div className="space-y-2">
              {calendars.filter(cal => cal.isShared).map((calendar) => (
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
                        {eventCounts[calendar.id] > 0 && (
                          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full ml-auto">
                            {eventCounts[calendar.id]}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      <Share2 className="h-3 w-3 text-accent" />
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
                            setNewCalendarColor(calendar.color);
                            setIsEditDialogOpen(true);
                          }}>
                            <Edit2 className="h-3 w-3 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleShare(calendar)}>
                            <Share2 className="h-3 w-3 mr-2" />
                            Share Settings
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
          </div>
        )}
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
              <div>
                <Label>Calendar Color</Label>
                <div className="grid grid-cols-6 gap-2 mt-2">
                  {getAvailableColors(editingCalendar?.id).concat(editingCalendar?.color ? [editingCalendar.color] : []).map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        newCalendarColor === color 
                          ? 'border-foreground shadow-md scale-110' 
                          : 'border-border hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewCalendarColor(color)}
                    />
                  ))}
                </div>
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
        <div className="mt-6 pt-4 border-t">
          <WakuStatus
            connectionStatus={connectionStatus}
            isConnected={isWakuConnected}
            connectionStats={connectionStats}
          />
        </div>
      </div>
  );
}