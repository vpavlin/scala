# Running a Scala hub

A **hub** is an always-on Scala core running headless (`logos-hub`, no Basecamp view) on a
machine with a public IP. It is a participant like any other device, but because it never sleeps
and is reachable from the internet it does two jobs the phones and laptops can't:

- **Keeps calendars in sync** while everyone else is offline (it holds the event log and answers
  catch-up requests).
- **Keeps attachments fetchable.** When it sees an event with attachments it fetches and serves
  them (*cache-on-see*), so a phone behind mobile NAT can download a file a desktop uploaded,
  after that desktop has gone offline. Without a hub, two devices both behind NAT can only reach
  each other through a relay capped at 128 KB, so larger attachments fail.

The hub only does this for calendars **it is a member of**.

## Add a calendar to the hub

1. **Get the calendar's share link.** In Basecamp click **share** next to the calendar and press
   **Copy**. On the phone tap **Share** next to the calendar, then **Copy link**. It looks like
   `scala://join?id=<calendar id>&key=<key>&name=<name>`.
2. **Join it on the hub**, on the hub machine (quote the link: it contains `&`):
   ```sh
   logos-hub call <daemon> scala handleShareLink 'scala://join?id=…&key=…&name=…' ''
   ```
   The last argument is the identity to post as; `''` means the hub's default. The hub never
   posts, so it doesn't matter. Expect `"result": true`.
3. **Check it arrived** (history takes up to a minute):
   ```sh
   logos-hub call <daemon> scala listCalendars
   logos-hub call <daemon> scala listEvents <calendar id>
   ```
4. **Attachments** are fetched automatically from then on. Existing ones arrive with the history;
   new ones as their events arrive. An uploader behind NAT becomes findable 2–4 minutes after its
   Storage node starts, so the hub retries a missing file every minute for 30 minutes. To check a
   file is cached:
   ```sh
   logos-hub call <daemon> storage_module exists <storageCid>
   ```

**If the calendar stays empty** while members are online: check the hub runs the same
`delivery_module` as the clients. Catch-up replies are large and arrive in segments, and an older
delivery build can fail to reassemble a newer client's segments. The hub then sees the raw
~60 KB pieces in its log but never the events. A 0.1.3 hub never received a 0.1.4 client's
history; upgrading the hub fixed it immediately.

**To stop** carrying a calendar: `logos-hub call <daemon> scala deleteCalendar <calendar id>`. This
only removes it from the hub; nobody else is affected. Files already cached stay in the hub's
Storage until they expire.

## What the hub can see

Joining gives the hub the calendar's key, so **whoever runs the hub can read that calendar's
events** (titles, times, attachment names), just like any member. Attachments are stored sealed
with the calendar key, so without the key the stored files are unreadable. Only add calendars to
a hub you run or trust.

## Hub settings

The hub is a Storage *root*: the node every client uses as its entry point to Storage. Set these
once in the hub's settings store (`<SCALA_CORE_DATA>/kv.json`, keys `set:<name>`). Edit the file
by hand while the hub is stopped, because the `logos-hub` CLI turns `1` into a number.

| Setting | Value | Why |
|---|---|---|
| `storage_root` | `"1"` | Run as the root of the private Storage network; no bootstrap node of its own |
| `storage_extip` | the public IP | The address clients dial; a root needs a reachable one |
| `storage_dir` | an absolute path | Keeps the node's key, and so its address, stable across restarts |
| `storage_nat_server` | `"0"` to disable | On by default for a root: lets clients behind NAT check reachability and relay through it, so their uploads can be found and cached |

Scala has **no built-in hub**: by default every client joins the public `logos.test` Storage network.
If you run your own hub, point your clients at it by setting `storage_bootstrap` to the hub's
bootstrap record (SPR) on the desktop, or entering it as the Storage hub in the phone's storage
settings. Get the SPR with `logos-hub call <daemon> storage_module debug` (`value.spr`).

Known limitation: two devices that are both behind NAT can't fetch each other's attachments
without a reachable node in between. A hub that has joined the calendar caches attachments as it
sees them, which is what makes them available while the uploader is offline.

### Storage patch the hub needs

A root that is the network's only DHT server must find provider records that other nodes stored
**on it**. Stock nim-libp2p's `getProviders` never checks those, so the hub could not find any
upload from a device behind NAT. The hub's `storage_module` is built with
`mobile/native/logosstorage/patches/nim-libp2p/0002-kad-getproviders-include-local-records.patch`
applied to its libstorage source. Clients don't need it.
