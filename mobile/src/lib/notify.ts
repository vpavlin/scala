// Local event reminders (#1). Purely on-device scheduled notifications — no server,
// no push tokens — which is exactly right for a local-first calendar: the events
// already live on the phone, so the phone can remind you about them offline.
//
// We fire one reminder LEAD_MS before each future event's start (or at start if it's
// sooner than that). On every data refresh we reconcile: cancel all and reschedule
// the current future set. A calendar rarely holds enough events for that churn to
// matter, and it keeps the schedule exactly in step with edits/deletes/synced-in events.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { CalEvent } from "./store";
import { expandEvents } from "./recur";

const HORIZON_MS = 45 * 24 * 60 * 60 * 1000; // schedule occurrences up to 45 days out
const MAX_SCHEDULED = 400;                   // stay well under the OS limit
const CHANNEL = "events";

// Foreground presentation (newer expo-notifications uses banner/list, not the old alert).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let granted = false;

export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    granted = status === "granted";
    if (granted && Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Event reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  } catch {
    granted = false;
  }
  return granted;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;               // a reconcile is in flight
let queued: CalEvent[] | null = null; // latest events that arrived while one was running
// Debounce bursts of refreshes (sync can fire many onChange in a row), then reconcile.
// Reminders are a BEST-EFFORT background concern — never let them sit on the edit path, so we
// debounce generously; the events are already saved locally, the reminder just trails them.
export function scheduleReminders(events: CalEvent[]): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void reconcile(events), 1500);
}

const yieldToUI = () => new Promise<void>((r) => setTimeout(r, 0)); // let React paint / touches run

async function reconcile(events: CalEvent[]): Promise<void> {
  if (!granted) return;
  // Never overlap: rescheduling is a long loop of native calls; two at once starve the UI thread.
  // If one is already running, just remember the newest set and run once more when it finishes.
  if (running) { queued = events; return; }
  running = true;
  try {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {
      return;
    }
    const now = Date.now();
    const fmt = (ms: number) =>
      new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    // Expand recurrence into concrete occurrences within the horizon, so a repeating
    // event fires a reminder for each upcoming instance (not just the master's start).
    const occ = expandEvents(events, now, now + HORIZON_MS).slice(0, MAX_SCHEDULED);
    let i = 0;
    for (const e of occ) {
      if (!e.startTime || e.startTime <= now) continue;
      const lead = (e.reminderMin ?? 10); // undefined → default 10 min
      if (lead <= 0) continue;            // 0 = no reminder
      const fireAt = e.startTime - lead * 60_000;
      if (fireAt <= now) continue;
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title: e.title || "Event", body: e.allDay ? "Today" : `Starts at ${fmt(e.startTime)}` },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(fireAt),
            channelId: CHANNEL,
          },
        });
      } catch {
        /* skip a single bad occurrence */
      }
      // Yield every few schedules so an edit's re-render / a tap isn't starved for seconds while
      // this long native loop runs. The reminders finish a beat later; the UI stays snappy.
      if (++i % 5 === 0) await yieldToUI();
    }
  } finally {
    running = false;
    if (queued) { const next = queued; queued = null; scheduleReminders(next); } // coalesced re-run
  }
}
