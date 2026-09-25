#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "scala_engine.hpp"
#include "scala_identity.hpp"  // per-device secp256k1 signing identity
#include <logos_module_context.h>  // LogosModuleContext base + logos_events: + modules()

// Forward declarations for internal components (ported to std types)
class CalendarStore;
class CalendarSync;
class QTimer;

/**
 * ScalaImpl — Universal-pattern core module for the Scala calendar app.
 *
 * Pure C++ class — no Qt, no Q_OBJECT, no Q_PLUGIN_METADATA.
 * All public methods are auto-exposed by logos-cpp-generator.
 * Inter-module calls via modules().kv_module.* (auto-generated typed SDK).
 * Events declared below with logos_events: section.
 */
class ScalaImpl : public LogosModuleContext {
public:
    ScalaImpl();
    ~ScalaImpl() override;

    // ── Namespace API ────────────────────────────────────────────────────────
    void setNamespace(const std::string& ns);

    // Core build version — the view checks this against the version it expects and warns on a
    // stale core (core + view are separate Basecamp packages; a stale core silently signs with the
    // wrong key while a fresh view shows the loam identities). Bump alongside metadata.json.
    std::string coreVersion() const;

    // ── Identity API ─────────────────────────────────────────────────────────
    std::string getIdentity() const;
    void setIdentity(const std::string& pubkeyHex);

    /// Enrol a physical Keycard as a loam identity (delegates entirely to loam_core; scala holds no
    /// keycard logic). `domain` should be "scala" so one card is one identity across phone + desktop.
    /// Async: returns a ref; progress + completion arrive on keycardStatus (then refresh identities).
    std::string enrollKeycard(const std::string& label, const std::string& domain);

    /// Snapshot of the current/last Keycard op for the poll-based view (mirrors the keycardStatus
    /// event): {active, purpose, phase, ref, calId, error?}. Drives the "hold your Keycard" overlay.
    std::string keycardState();

    // ── Calendar CRUD ────────────────────────────────────────────────────────
    /// Create a new calendar. Returns the calendar ID.
    std::string createCalendar(const std::string& name, const std::string& color, const std::string& identityId = "");

    /// List all calendars. Returns JSON array string.
    std::string listCalendars();

    /// Delete a calendar and all its events.
    bool deleteCalendar(const std::string& id);

    /// #7/#8: edit shared calendar metadata — JSON {name?,color?,description?,schema?}.
    bool updateCalendarMeta(const std::string& calId, const std::string& fieldsJson);

    /// #3: grant/revoke a member — role is "admin"|"viewer"|"remove" (fold enforces owner/admin).
    bool setMemberRole(const std::string& calId, const std::string& member, const std::string& role);
    /// Same as setMemberRole but with all fields in one JSON arg {calId,member,role} — so a 0x… member
    /// address survives a CLI/headless caller (bare-arg role setting hits logoscore's hex-number typing).
    bool manageMember(const std::string& json);

    // ── Event CRUD ───────────────────────────────────────────────────────────
    /// Create an event in a calendar. Returns the event ID.
    std::string createEvent(const std::string& calendarId, const std::string& eventJson);

    /// Create an event from explicit scalar fields (no JSON, no commas) — usable from
    /// the logoscore CLI, which splits args on commas and types numbers as int. start/end
    /// are epoch-ms passed as STRINGS. Lets a headless hub inject a real, visible event.
    std::string createEventAt(const std::string& calendarId, const std::string& title,
                              const std::string& startMs, const std::string& endMs);

    /// Update an existing event. Returns the event ID.
    std::string updateEvent(const std::string& eventJson);

    /// Delete an event.
    bool deleteEvent(const std::string& id);

    /// List all events in a calendar. Returns JSON array string.
    std::string listEvents(const std::string& calendarId);
    std::string listAllEvents();

    /// #4: per-event edit history — [{author,at,action,payload}] from the raw log.
    std::string getEventHistory(const std::string& calId, const std::string& eventId);
    // Set MY attendance on an event (ADR 0021); self-scoped, no edit-rights needed.
    std::string setRsvp(const std::string& calendarId, const std::string& eventId, const std::string& status);

    // ── Snapshots (ADR 0020): bootstrap catch-up from one sealed Storage blob ──
    // Cut the calendar's log at the latest completed epoch (default 1h), serialize + AES-seal it +
    // upload to Storage; the CID arrives async (getSnapshotPointer). `epochSizeMsStr` = epoch size ms
    // as a string ("" → 3600000). Returns {"ok":true,"status":"uploading",epoch,count} JSON.
    std::string snapshotCalendar(const std::string& calendarId, const std::string& epochSizeMsStr);
    // The last COMPLETED snapshot pointer for a calendar: {v,cid,epoch,coversUpToHlc,count} — or "{}".
    std::string getSnapshotPointer(const std::string& calendarId);
    // This node's Codex SPR (signed peer record) — the `stor` a snapshot invite carries so a fetcher
    // can dial this node's storage. Empty string if storage isn't up.
    std::string getStorageSpr();

    /// Get a single event by ID. Returns JSON object string.
    std::string getEvent(const std::string& id);

    // ── Sync API ─────────────────────────────────────────────────────────────
    /// Share a calendar. Returns the encryption key.
    std::string shareCalendar(const std::string& calendarId);

    /// Join a shared calendar with the provided encryption key.
    bool joinSharedCalendar(const std::string& calendarId, const std::string& encryptionKey);

    /// Get the current sync status for a calendar.
    std::string getSyncStatus(const std::string& calendarId);

    /// Encode text as a REAL QR code matrix (vendored qrcodegen). Returns JSON
    /// {"ok":true,"n":<size>,"cells":[0|1,...row-major],"text":...} for the view
    /// to draw on a Canvas (data: URIs are blocked in the sandbox).
    std::string qrMatrix(const std::string& text);

    /// Connection + events diagnostics for the debug panel. JSON:
    /// {identity, nodeReady, calendarCount, eventCount, calendars:[{id,name,shared,syncing,events,creatorId}]}
    std::string diagnostics();

    // ── Share link API ───────────────────────────────────────────────────────
    /// Generate a scala:// share link for a calendar.
    std::string generateShareLink(const std::string& calendarId);

    /// Parse a scala:// share link. Returns JSON with calendar info.
    std::string parseShareLink(const std::string& link);

    /// Handle a scala:// share link (join the calendar).
    bool handleShareLink(const std::string& link, const std::string& identityId = "");

    // ── Search API ───────────────────────────────────────────────────────────
    /// Search events across all calendars by title/description/location. Returns JSON array string.
    std::string searchEvents(const std::string& query);

    // ── Reminders API ────────────────────────────────────────────────────────
    /// Events whose reminder window is currently open, across all calendars, occurrence-expanded.
    /// Returns a JSON array of {calendarId,id,title,startTime,occ,reminderMin,location}. `occ` is the
    /// concrete occurrence start (ms) the reminder is for (== startTime for non-recurring events).
    std::string getPendingReminders();

    // ── iCalendar (RFC 5545) interop ─────────────────────────────────────────
    /// Export a calendar to an .ics document (VCALENDAR/VEVENT text). "" if the calendar is unknown.
    std::string exportCalendarIcs(const std::string& calendarId);
    /// Import VEVENTs from an .ics document into a calendar (each authored as a normal signed event).
    /// Returns {"imported":N,"skipped":M} (or {"imported":0,"error":"…"}).
    std::string importIcs(const std::string& calendarId, const std::string& icsText);
    /// Write a calendar's .ics to filePath (adds a .ics suffix if missing). {"ok":true,"path":…,"events":N}.
    std::string exportCalendarIcsFile(const std::string& calendarId, const std::string& filePath);
    /// Read an .ics file and import it. {"imported":N,"skipped":M} (or {"imported":0,"error":"…"}).
    std::string importIcsFile(const std::string& calendarId, const std::string& filePath);

    // ── Settings API ─────────────────────────────────────────────────────────
    void setSetting(const std::string& key, const std::string& value);
    std::string getSetting(const std::string& key, const std::string& defaultValue);

    // ── Attachments (ADR 0017 — files in Logos Storage, referenced by CID) ─────
    /// Seal a local file with the calendar key and upload it to Logos Storage. Async: returns a
    /// `ref` immediately; completion arrives on the `attachmentUploaded` event with the CID. The
    /// view then adds {name,mime,size,storageCid,blobId} to the event's `attachments` array.
    std::string uploadAttachment(const std::string& calendarId, const std::string& filePath,
                                 const std::string& name, const std::string& mime);
    /// Fetch a CID from Storage + decrypt it to a local file. Async: returns a `ref`; completion on
    /// the `attachmentReady` event with the on-disk path the view opens.
    std::string downloadAttachment(const std::string& calendarId, const std::string& cid,
                                   const std::string& name);
    /// Directory downloaded (decrypted) attachments are written to (for the view to open).
    std::string attachmentsDir();

    /// Poll the outcome of an upload/download `ref` (the poll-based view avoids async signal
    /// handlers, per the no-blocking-IPC rule). Returns {"pending":true} until done, then the same
    /// JSON the attachmentUploaded/attachmentReady event carried ({ok,cid,name,mime,size,blobId} or
    /// {ok,path,name} or {ok:false,error}).
    std::string attachmentStatus(const std::string& ref);

    // ── Context lifecycle ────────────────────────────────────────────────────
    /// Called when the module context is fully initialized (deps are live).
    void onContextReady() override;

    // ── Events — emitted to subscribers via the host's eventResponse channel ─
logos_events:
    /// Emitted when a calendar's sync status changes.
    void syncStatusChanged(const std::string& calendarId, const std::string& status);

    /// Emitted when the module identity changes.
    void identityChanged();

    /// Progress of an async Keycard authoring/enrol op (scala ADR 0016). statusJson =
    /// {purpose:"event"|"enroll", phase:"pending"|"done"|"failed", error?}. The view shows a
    /// "hold your Keycard" overlay on pending and clears it on done/failed. calId is "" for enrol.
    void keycardStatus(const std::string& calId, const std::string& ref, const std::string& statusJson);

    /// Completion of uploadAttachment. resultJson = {ok:true, cid, name, mime, size, blobId} or
    /// {ok:false, error}. The view merges the ref into the event's `attachments` on ok.
    void attachmentUploaded(const std::string& calId, const std::string& ref, const std::string& resultJson);

    /// Completion of downloadAttachment. resultJson = {ok:true, path, name} or {ok:false, error}.
    void attachmentReady(const std::string& calId, const std::string& ref, const std::string& resultJson);

private:
    CalendarStore* m_store = nullptr;
    CalendarSync* m_sync = nullptr;
    QTimer* m_resyncTimer = nullptr;      // periodic RBSR catch-up for every calendar (recovers drops after warmup)
    std::string m_identity;      // == m_signId.address (the "0x…" author id)
    scala::SignId m_signId;      // secp256k1 keypair; private key persisted in the kv store
    std::string m_namespace;
    bool m_ctxReady = false;              // onContextReady() actually fired
    std::string m_deliveryStatus;         // last transport status (Connecting/Connected/error)

    // ── event-log CRDT helpers ───────────────────────────────────────────────
    long long m_wall = 0;                 // HLC clock
    long long m_ctr = 0;
    scala::HLC nextHlc();
    scala::Event mkEvent(const std::string& type, const scala::json& payload, const std::string& calId = "");
    void publishAndApply(const std::string& calId, const scala::Event& e);  // append locally + broadcast
    // Author a user write: if the calendar is bound to a KEYCARD identity, sign async via loam_core
    // (card tap) and publish on completion; otherwise sign + publish synchronously. SYNC_REQ never
    // routes here (no card tap for reconciliation). (scala ADR 0016)
    void authorAndPublish(const std::string& type, const scala::json& payload, const std::string& calId);
    bool authorEvent(const std::string& type, const scala::json& payload, const std::string& calId);  // true = handled async (keycard)
    void emitKcStatus(const std::string& calId, const std::string& ref, const char* purpose, const char* phase, const std::string& error);
    struct PendingKc { std::string calId; scala::Event event; };
    std::map<std::string, PendingKc> m_pendingKc;   // events awaiting a card signature, keyed by event id (== ref)
    std::string m_kcState = "{\"active\":false}";   // last keycard op snapshot, polled by keycardState()
    void applyIncoming(const std::string& calId, const std::string& eventJson);  // merge a received event

    // ── Attachments / Logos Storage (ADR 0017) ────────────────────────────────
    bool m_storageInit = false;          // storage_module init+start issued + events subscribed
    bool m_storageCbReg = false;         // upload/download callbacks registered (once, survive node restart)
    bool m_storageMeshOn = false;        // storage node started in shrooms-mesh mode (dialable mesh extip)
    std::string m_storageDir;            // libstorage data-dir (persistent cache)
    void ensureStorage();                // idempotent: subscribe events + init + start the node
    // ADR 0020: (re)start the storage node so its Codex SPR announces a shrooms-mesh address, so a
    // fetcher (e.g. a phone that is a mesh peer) can dial it over the overlay. No-op off the mesh.
    void ensureStorageMesh();
    void cacheAttachments(const scala::Event& e);  // cache-on-see: fetch any attachment CID we lack → become a provider
    struct PendingUp { std::string calId, name, mime, blobId, tmpPath; long long size = 0; };
    std::map<std::string, PendingUp> m_pendUp;     // storage sessionId -> pending upload
    struct PendingDown { std::string calId, name, cid, sealedPath, outPath; };
    std::map<std::string, PendingDown> m_pendDown; // storage sessionId -> pending download
    struct PendingSnap { std::string calId, tmpPath; long long epoch = 0, count = 0; };
    std::map<std::string, PendingSnap> m_pendSnap;   // storage sessionId -> pending snapshot upload (ADR 0020)
    std::map<std::string, std::string> m_lastSnapshot; // calId -> last completed snapshot pointer JSON
    void onStorageUploadDone(const std::string& payload);
    void onStorageDownloadDone(const std::string& payload);
    std::map<std::string, std::string> m_attachResults;   // ref -> result JSON, polled by attachmentStatus
    // store the poll result AND emit the async event (view uses the poll; the event is for others)
    void finishUpload(const std::string& calId, const std::string& ref, const std::string& json);
    void finishDownload(const std::string& calId, const std::string& ref, const std::string& json);
    // ── catch-up (qaku SYNC_REQ + seed) ──────────────────────────────────────
    void onSyncReq(const std::string& calId, const nlohmann::json& req);  // serve ONLY the delta a peer lacks (logos_sync catch-up)
    void sendSyncReq(const std::string& calId);   // publish our id-summary so peers serve our gap (on join/connect + retries)
    std::map<std::string, long long> m_lastServe; // per-calendar rate-limit for the SYNC_REQ response
    // Idempotently (re)attempt the delivery bootstrap. Called from onContextReady
    // AND lazily from the polled read methods (kym self-drive pattern) so the node
    // comes up even if the lifecycle hook is flaky / there were no shared calendars
    // at startup.
    void ensureDelivery();

    // Handle incoming sync messages from CalendarSync
    void onSyncMessageReceived(const std::string& calendarId, const std::string& msgJson);
};
