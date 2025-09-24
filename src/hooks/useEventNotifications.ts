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
      if (!event.time) return false;
      
      // Combine date and time
      const [hours, minutes] = event.time.split(':').map(Number);
      const eventStart = new Date(event.date);
      eventStart.setHours(hours, minutes, 0, 0);
      
      const notificationTime = addMinutes(eventStart, -15); // 15 minutes before
      
      return isAfter(eventStart, now) && 
             isBefore(notificationTime, addMinutes(now, 60)) && // Within next hour
             isAfter(notificationTime, now); // But not in the past
    });

    upcomingEvents.forEach(event => {
      if (!event.time) return;
      
      const [hours, minutes] = event.time.split(':').map(Number);
      const eventStart = new Date(event.date);
      eventStart.setHours(hours, minutes, 0, 0);
      
      const notificationTime = addMinutes(eventStart, -15);
      const timeUntilNotification = notificationTime.getTime() - now.getTime();

      if (timeUntilNotification > 0) {
        setTimeout(() => {
          new Notification(`Upcoming Event: ${event.title}`, {
            body: `Starting in 15 minutes at ${eventStart.toLocaleTimeString()}`,
            icon: '/favicon.ico',
            tag: event.id,
          });
        }, timeUntilNotification);
      }
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