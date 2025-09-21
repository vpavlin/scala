import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WakuCalendarSync } from '@/lib/wakuSync';
import CalendarApp from './CalendarApp';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function SharedCalendar() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [calendarData, setCalendarData] = useState<{ calendarId: string; encryptionKey?: string } | null>(null);

  useEffect(() => {
    const calendarId = searchParams.get('calendar');
    const encryptionKey = searchParams.get('key') || undefined;

    if (!calendarId) {
      setError('Invalid share link: missing calendar ID');
      return;
    }

    setCalendarData({ calendarId, encryptionKey });
  }, [searchParams]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Alert className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!calendarData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading shared calendar...</div>
      </div>
    );
  }

  return (
    <CalendarApp 
      sharedCalendarId={calendarData.calendarId} 
      sharedEncryptionKey={calendarData.encryptionKey}
    />
  );
}