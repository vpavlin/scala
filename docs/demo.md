# Demo script: Scala in 5 minutes

For showing Scala to anyone who shares a calendar with other people: a team, a family, a club.
One laptop with Basecamp, one Android phone. Everything runs on the public demo calendar
"Scala Demo", which an always-on hub keeps available. All events are made up.

## Before (10 minutes, once)

**Phone:** add the F-Droid repo from [apps.vpavlin.xyz](https://apps.vpavlin.xyz) and install
**Scala** (0.9.115 or newer) and **Loam** (0.0.55 or newer). Scala uses Loam's shared node by
default: open Loam once, leave it running, then open Scala and approve it in Loam when asked.
(Without Loam, turn off *Shared node* in Scala's ☰ menu and restart Scala; it then runs its own node.)

**Laptop:** Basecamp 0.3. Add the package repository `https://apps.vpavlin.xyz/logos-repo.json`
and install **Scala** (its core and Loam modules come along).

**Join the demo calendar on both.** Phone: ☰ → *Join a calendar*, paste, tap *Join*.
Laptop: Scala → *Join calendar*, paste, click *Join*. The link:

```
scala://join?id=83cc44c6-3586-4939-a511-a8c576afc482&key=OWRjNzdlMzAtZDNkOS00YjVkLWFjOGQtNGJlZmUxOTJiYmM5MWRjYjEwMWYtZjEyNS00ZWJhLWIyNDQtYTk2NDRlZDgyMTY0&name=Scala%20Demo
```

The phone can take a minute or two to catch up; in the ☰ menu the calendar's chip goes from
*syncing* to *up to date*. Check both screens show the same events (Welcome, Scala for artists,
Coffee & Scala, Edit me, Studio open hours, Team sync) before you start. The calendar is open to
anyone with the link: other people may have edited it, which is fine, it's a demo.

## The demo

**1. A normal calendar (laptop, 45 s).** Open Scala.
- *Month* / *Week* / *Day* at the top, *Today* to jump back. The calendar list on the left.
- Point at the weekly **Team sync** and **Studio open hours**: repeating events, like any calendar.
- *Say:* it looks like a calendar you already know. The difference is where it lives.

**2. The same calendar on the phone (30 s).** Show the phone: same month, same events.
- Tap *Agenda* for a list view; ☰ shows the calendar with an *up to date* chip.
- *Say:* there's no server and no account. This calendar lives on the devices of the people in
  it, encrypted so only they can read it.

**3. Change something, watch the phone (1 min). The aha moment.**
- On the laptop, click **Edit me**, change the title (e.g. "Edited live at the demo"), click *Save*.
- On the phone the title changes within seconds. "The laptop and the phone talked to each other,
  peer to peer. Nobody in the middle can read it, not even the network carrying it."
- On the phone, tap the event, type in *Add a comment…*, tap *Post*. It appears on the laptop.

**4. Make an event (phone, 45 s).** Tap the round **+** button.
- Title, time, maybe a *Location*; tap *Create*. It shows up on the laptop.
- On the laptop, open it: *Your RSVP* (Going / Maybe / No) and the *History* of who did what.
- *Say:* every change is signed by the person who made it, so you always know who moved the meeting.

**5. Offline, then merge (1 min).**
- Put the phone in airplane mode. Edit an event on the phone (say, Coffee & Scala's time) and,
  at the same time, a different event on the laptop.
- Turn airplane mode off. Within a minute both devices show both changes.
- *Say:* everyone can keep working without a connection. When they meet again, nothing is lost.

**6. Inviting someone (laptop, 30 s).** Click *share* next to the calendar.
- "Scan this on the phone, or copy the link": that's the whole invite. On the phone it's ☰ →
  *Scan QR code*.
- *Optional:* the ⚙ next to the calendar shows *Access* (Closed / Open / Collaborative) and,
  on calendars that use roles, *Members* and *Invite as editor / viewer*.

## If something goes wrong

- **Events don't appear on the phone:** check Loam is running and Scala is approved there (Scala
  shows a Loam banner at the top if not). Catch-up can take a minute or two; reopening Scala helps.
- **An event opens as "🔒 Read-only":** someone changed the demo calendar's access; pick an
  event you created yourself, or make a new one.
- **Nothing syncs at all:** the hub may be restarting; wait two minutes. The phone and laptop also
  sync directly when both are online. On the laptop, *Debug* → *Per-calendar sync* shows the state.
- **Comments don't show on the laptop:** update the Scala packages in Basecamp.

## What to leave them with

- Phone + desktop, same calendar, no server, no account, encrypted to its members.
- Works offline; edits merge when devices meet again.
- [apps.vpavlin.xyz](https://apps.vpavlin.xyz) to install; the join link above to try it yourself.
