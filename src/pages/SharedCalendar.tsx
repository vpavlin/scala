import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CalendarApp from './CalendarApp';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useCalendarStorage } from '@/hooks/useCalendarStorage';
import { CalendarData } from '@/lib/storage';
import { toast } from '@/hooks/use-toast';

export default function SharedCalendar() {
  const storage = useCalendarStorage();
  const [searchParams] = useSearchParams();
  const [sharedCalendarId, setSharedCalendarId] = useState<string | null>(null);
  const [sharedEncryptionKey, setSharedEncryptionKey] = useState<string | undefined>(undefined);
  const [sharedCalendarName, setSharedCalendarName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const calendarId = searchParams.get('calendar');
    const calendarName = searchParams.get('name');
    const encryptionKey = searchParams.get('key') || undefined;

    console.log('SharedCalendar URL params:', { calendarId, calendarName, encryptionKey });

    if (calendarId && calendarName) {
      const decodedName = decodeURIComponent(calendarName);
      console.log('Decoded calendar name:', decodedName);
      
      setSharedCalendarId(calendarId);
      setSharedCalendarName(decodedName);
      setSharedEncryptionKey(encryptionKey);
      
      // Create calendar entry in local storage
      const createSharedCalendar = async () => {
        if (!storage.isInitialized) return;
        
        try {
          // Check if calendar already exists
          const existingCalendars = await storage.loadCalendars();
          const existingCalendar = existingCalendars.find(cal => cal.id === calendarId);
          
          if (!existingCalendar) {
            // Create new shared calendar entry
            const sharedCalendar: CalendarData = {
              id: calendarId,
              name: decodeURIComponent(calendarName),
              color: '#8b5cf6', // purple for shared calendars
              isVisible: true,
              isShared: true,
              isPrivate: !!encryptionKey,
              shareUrl: window.location.href
            };
            
            await storage.saveCalendar(sharedCalendar);
            console.log('Created shared calendar entry:', sharedCalendar);
            
            toast({
              title: "Calendar added",
              description: `Shared calendar "${sharedCalendar.name}" has been added to your calendars.`
            });
          } else {
            console.log('Shared calendar already exists:', existingCalendar);
          }
        } catch (error) {
          console.error('Failed to create shared calendar entry:', error);
          toast({
            title: "Error",
            description: "Failed to save shared calendar to local storage.",
            variant: "destructive"
          });
        } finally {
          setIsLoading(false);
        }
      };
      
      createSharedCalendar();
    } else {
      console.error('Missing required URL parameters: calendar and/or name');
      setError('Invalid share link: missing required information');
      setIsLoading(false);
    }
  }, [storage.isInitialized, searchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto"></div>
          <h2 className="text-xl font-semibold">Setting up shared calendar...</h2>
          <p className="text-muted-foreground">
            Adding "{sharedCalendarName}" to your calendars
          </p>
        </div>
      </div>
    );
  }

  if (error || !sharedCalendarId || !sharedCalendarName) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'This share link is missing required information. Please check the URL and try again.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <CalendarApp 
      sharedCalendarId={sharedCalendarId} 
      sharedEncryptionKey={sharedEncryptionKey} 
    />
  );
}