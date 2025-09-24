import { useEffect, useCallback } from 'react';
import { CalendarEvent } from '@/lib/wakuSingleNode';
import { isAfter, isBefore, addMinutes } from 'date-fns';

interface UseEventNotificationsProps {
  events: CalendarEvent[];
  enabled?: boolean;
}

export const useEventNotifications = ({ events, enabled = true }: UseEventNotificationsProps) => {
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('This browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }, []);

  const scheduleNotifications = useCallback(async () => {
    if (!enabled || !await requestPermission()) {
      return;
    }

    const now = new Date();
    const upcomingEvents = events.filter(event => {
      if (!event.time || !event.reminders || event.reminders.length === 0) return false;
      
      // Combine date and time
      const [hours, minutes] = event.time.split(':').map(Number);
      const eventStart = new Date(event.date);
      eventStart.setHours(hours, minutes, 0, 0);
      
      // Check if event is in the future
      return isAfter(eventStart, now);
    });

    upcomingEvents.forEach(event => {
      if (!event.time || !event.reminders) return;
      
      const [hours, minutes] = event.time.split(':').map(Number);
      const eventStart = new Date(event.date);
      eventStart.setHours(hours, minutes, 0, 0);

      // Schedule notification for each reminder
      event.reminders.forEach(reminderMinutes => {
        const notificationTime = addMinutes(eventStart, -reminderMinutes);
        const timeUntilNotification = notificationTime.getTime() - now.getTime();

        if (timeUntilNotification > 0 && timeUntilNotification < 24 * 60 * 60 * 1000) { // Within 24 hours
          setTimeout(() => {
            const timeText = reminderMinutes === 0 ? 'now' :
                           reminderMinutes < 60 ? `in ${reminderMinutes} minute${reminderMinutes !== 1 ? 's' : ''}` :
                           reminderMinutes < 1440 ? `in ${Math.floor(reminderMinutes / 60)} hour${Math.floor(reminderMinutes / 60) !== 1 ? 's' : ''}` :
                           `in ${Math.floor(reminderMinutes / 1440)} day${Math.floor(reminderMinutes / 1440) !== 1 ? 's' : ''}`;
            
            new Notification(`${reminderMinutes === 0 ? 'Event Starting' : 'Upcoming Event'}: ${event.title}`, {
              body: `${reminderMinutes === 0 ? 'Starting now' : `Starting ${timeText}`} at ${eventStart.toLocaleTimeString()}`,
              icon: '/favicon.png',
              tag: `${event.id}-${reminderMinutes}`,
            });
          }, timeUntilNotification);
        }
      });
    });
  }, [events, enabled, requestPermission]);

  useEffect(() => {
    if (enabled) {
      scheduleNotifications();
    }
  }, [scheduleNotifications, enabled]);

  return {
    requestPermission,
    scheduleNotifications,
  };
};