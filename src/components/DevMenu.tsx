import { useState } from 'react';
import { Settings, Database, Trash2, Plus, TestTube } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { CalendarData } from '@/lib/storage';
import { CalendarEvent } from '@/lib/wakuSync';
import { generateUUID } from '@/lib/uuid';

interface DevMenuProps {
  onClearDatabase: () => Promise<void>;
  onPopulateExampleData: (calendars: CalendarData[], events: CalendarEvent[]) => Promise<void>;
}

export function DevMenu({ onClearDatabase, onPopulateExampleData }: DevMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isPopulating, setIsPopulating] = useState(false);

  const handleClearDatabase = async () => {
    setIsClearing(true);
    try {
      await onClearDatabase();
      toast({
        title: "Database cleared",
        description: "All calendars and events have been removed."
      });
    } catch (error) {
      toast({
        title: "Failed to clear database",
        description: "An error occurred while clearing the database.",
        variant: "destructive"
      });
    } finally {
      setIsClearing(false);
    }
  };

  const generateExampleData = () => {
    const calendars: CalendarData[] = [
      {
        id: generateUUID(),
        name: 'Work Projects',
        color: '#3b82f6',
        isVisible: true,
        isShared: false
      },
      {
        id: generateUUID(),
        name: 'Team Calendar',
        color: '#10b981',
        isVisible: true,
        isShared: true,
        isPrivate: false
      }
    ];

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const events: CalendarEvent[] = [
      {
        id: generateUUID(),
        title: 'Project Kickoff Meeting',
        date: today,
        time: '09:00',
        calendarId: calendars[0].id,
        description: 'Initial planning session for the new project.'
      },
      {
        id: generateUUID(),
        title: 'Client Presentation',
        date: tomorrow,
        time: '14:30',
        calendarId: calendars[0].id,
        description: 'Present the quarterly results to the client.'
      },
      {
        id: generateUUID(),
        title: 'Team Standup',
        date: today,
        time: '10:00',
        calendarId: calendars[1].id,
        description: 'Daily team synchronization meeting.'
      },
      {
        id: generateUUID(),
        title: 'Sprint Planning',
        date: nextWeek,
        time: '09:30',
        calendarId: calendars[1].id,
        description: 'Plan the upcoming sprint and assign tasks.'
      },
      {
        id: generateUUID(),
        title: 'All Hands Meeting',
        date: nextWeek,
        calendarId: calendars[1].id,
        description: 'Company-wide meeting (all day event).'
      }
    ];

    return { calendars, events };
  };

  const handlePopulateData = async () => {
    setIsPopulating(true);
    try {
      const { calendars, events } = generateExampleData();
      await onPopulateExampleData(calendars, events);
      toast({
        title: "Example data populated",
        description: `Added ${calendars.length} calendars and ${events.length} events.`
      });
    } catch (error) {
      toast({
        title: "Failed to populate data",
        description: "An error occurred while adding example data.",
        variant: "destructive"
      });
    } finally {
      setIsPopulating(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full shadow-lg hover:shadow-xl transition-shadow bg-background border-2"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TestTube className="h-5 w-5" />
              Development Options
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Database Management
                </CardTitle>
                <CardDescription>
                  Manage your local calendar database for testing purposes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="destructive"
                  onClick={handleClearDatabase}
                  disabled={isClearing}
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {isClearing ? 'Clearing...' : 'Clear Database'}
                </Button>
                
                <Separator />
                
                <Button
                  variant="outline"
                  onClick={handlePopulateData}
                  disabled={isPopulating}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {isPopulating ? 'Populating...' : 'Populate Example Data'}
                </Button>
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Clear Database:</strong> Removes all calendars and events from IndexedDB.</p>
              <p><strong>Populate Example Data:</strong> Adds 2 sample calendars (1 shared, 1 private) with 5 events.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}