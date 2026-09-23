#pragma once
// Scala calendar engine — the pure, deterministic fold from a merged event log to
// calendar state. Modeled directly on qaku_engine.hpp (event-log CRDT): every
// change is an immutable event; current state = fold over the merged log. Merge is
// union-by-id + HLC sort, so it is idempotent (redelivery is a no-op), commutative
// and associative (arrival order is irrelevant) — offline devices converge with no
// lost writes.
//
// One channel == one calendar; its log holds that calendar's events. The JS mobile
// app mirrors this fold byte-for-byte (see mobile/src/lib/engine.ts).
#include <string>
#include <vector>
#include <map>
#include <set>
#include <algorithm>
#include <nlohmann/json.hpp>

// The event envelope, HLC and CRDT merge now come from the shared logos-sync
// library (vendored under logos_sync/) — they were already byte-identical to
// scala's hand-written copies, so this is a pure de-duplication. What stays
// scala's: the ET:: event types and foldCalendar below (logos-sync ADR 0007).
#include "logos_sync/event.hpp"
#include "logos_sync/merge.hpp"
#include "scala_identity.hpp"   // event signature verification (authenticity)

namespace scala {
using json = nlohmann::json;

// Adopt the shared spine into the scala:: namespace so the rest of the module
// (CalendarSync, ScalaImpl) keeps compiling unchanged against scala::Event etc.
using logos_sync::HLC;
using logos_sync::compareHlc;
using logos_sync::Event;
using logos_sync::eventToJson;
using logos_sync::eventFromJson;
using logos_sync::mergeEvents;

// Event type constants — keep in lockstep with mobile/src/lib/engine.ts.
namespace ET {
    constexpr const char* CAL_META  = "cal.meta";    // {name,color}          — calendar metadata (LWW)
    constexpr const char* EVENT_PUT = "event.put";   // {id,title,startTime,…}— create/edit an event (LWW upsert by id)
    constexpr const char* EVENT_DEL = "event.del";   // {id}                  — tombstone an event (terminal)
    constexpr const char* MEMBER_SET = "member.set"; // {member,role}         — roles (#3): owner/admin grants admin|viewer|remove. Opt-in: no member.set = open calendar.
    constexpr const char* EVENT_RSVP = "event.rsvp"; // {eventId,status}       — attendance (ADR 0021): LWW per (eventId,author); self-scoped
    constexpr const char* EXT       = "ext";         // {ns,kind,target,id,data}— generic extension (ADR 0021): app data on a target; `data` OPAQUE. supersede by id (creator/editor)
    constexpr const char* EXT_DEL   = "ext.del";     // {id}                   — tombstone an ext item (terminal); by the item's author OR an owner/editor
    constexpr const char* SYNC_REQ  = "sync.req";    // {have:[id…], from} — CATCH-UP: a joining peer publishes the ids it already holds; peers serve ONLY the delta (logos_sync::catchup). NOT stored, NOT folded (foldCalendar ignores unknown types); handled in the receive path → onSyncReq().
}

// eventToJson / eventFromJson / mergeEvents now come from logos_sync (aliased
// above) — they were byte-identical to the copies that used to live here.

// ── fold: merged log → calendar state ────────────────────────────────────────
// Returns {name, color, events:[…]}. cal.meta is LWW (last by HLC wins). Events are
// LWW upsert by event id; a tombstone is TERMINAL (a later edit can't resurrect it).
inline json foldCalendar(const std::string& calId, const std::vector<Event>& log) {
    auto ordered = mergeEvents(log);
    std::string name, color, description, owner;
    json schema = json::array();          // OPTIONAL custom-field definitions; empty by
                                          // default so a plain calendar shows nothing extra.
    std::map<std::string, json> events;   // event id -> event payload
    std::set<std::string> tombstones;
    std::map<std::string, std::map<std::string, std::string>> rsvpOf; // eventId -> (author -> status) — ADR 0021, LWW by HLC
    // ADR 0021 generic extensions. extCreator: id -> first author (owns supersede/delete). extItem:
    // id -> current item (author stays the creator; data/hlc advance on supersede). extTomb: deleted.
    struct ExtItem { std::string ns, kind, target, id, author; HLC hlc; json data; };
    std::map<std::string, std::string> extCreator;
    std::map<std::string, ExtItem> extItem;
    std::set<std::string> extTomb;

    // ── roles + permissions (two rules; owner/editor/viewer + Open toggle) ────
    // owner = author of the earliest cal.meta. roleOf grants "editor"/"viewer". Two rules:
    //   1. Owner + Editors may do anything; explicit Viewers are read-only.
    //   2. Everyone else (a "participant" — anyone with the key) may ADD events iff the
    //      calendar is OPEN, and may EDIT/DELETE only the events THEY authored.
    // → "editing someone else's event needs to be an Editor" falls out for free, using the
    // per-event author (creatorId). Authenticity: a privileged (owner/editor) claim is
    // trusted only when the event is signed by that author; unsigned legacy events are still
    // admitted (best-effort author). Single HLC-ordered pass → order-independent, convergent.
    std::map<std::string, std::string> roleOf;    // dev -> "editor"|"viewer"
    std::map<std::string, std::string> creatorOf; // event id -> ORIGINAL author (edit-your-own)
    bool rolesConfigured = false;
    bool openCal = true;                          // cal.meta "open" (LWW): may participants add? default yes
    bool collabCal = false;                       // cal.meta "collab" (LWW): may any non-viewer edit ANY event?

    auto isEditor = [&](const std::string& dev, bool verified) -> bool {
        if (rolesConfigured && !verified) return false;    // privileged claim must be authenticated
        if (dev == owner) return true;
        auto it = roleOf.find(dev);
        return it != roleOf.end() && (it->second == "editor" || it->second == "admin");
    };
    auto isViewer = [&](const std::string& dev) -> bool {
        auto it = roleOf.find(dev);
        return it != roleOf.end() && it->second == "viewer";
    };
    auto canAdd = [&](const std::string& dev, bool verified) -> bool {
        if (isEditor(dev, verified)) return true;
        if (isViewer(dev)) return false;
        return openCal;                                    // participant may add iff Open
    };
    auto canEditExisting = [&](const std::string& dev, const std::string& creator, bool verified) -> bool {
        if (isEditor(dev, verified)) return true;
        if (isViewer(dev)) return false;
        if (collabCal) return true;                        // Collaborative: any non-viewer edits anything
        return !creator.empty() && dev == creator;         // else edit only your OWN
    };

    for (const auto& e : ordered) {
        // A present-but-invalid signature means the event was forged/tampered → drop it
        // entirely. An UNSIGNED (legacy) event is admitted but never counts as authenticated.
        const bool signed_ = isSigned(e);
        const bool verified = signed_ && verifyEvent(e);
        if (!verified) continue;   // signatures ALWAYS required — every event is signed via the loam identity; drop unsigned/tampered
        const std::string& author = e.dev;
        if (e.type == ET::CAL_META) {
            bool creating = owner.empty();
            if (creating) owner = author;                  // creator = first cal.meta author
            if (!creating && !isEditor(author, verified)) continue;  // only owner/editors change settings
            if (e.payload.contains("name"))        name        = e.payload.value("name", name);
            if (e.payload.contains("color"))       color       = e.payload.value("color", color);
            if (e.payload.contains("description")) description = e.payload.value("description", description);
            if (e.payload.contains("schema") && e.payload["schema"].is_array()) schema = e.payload["schema"];
            if (e.payload.contains("open"))               openCal     = e.payload.value("open", true);
            if (e.payload.contains("collab"))             collabCal   = e.payload.value("collab", false);
        } else if (e.type == ET::MEMBER_SET) {
            // A role grant is admitted only from an AUTHENTICATED owner/editor.
            bool authed = verified && (author == owner || (roleOf.count(author) && (roleOf[author] == "editor" || roleOf[author] == "admin")));
            if (owner.empty() || !authed) continue;
            std::string m = e.payload.value("member", std::string());
            std::string r = e.payload.value("role", std::string());
            if (m.empty() || m == owner) continue;         // owner role is fixed
            rolesConfigured = true;
            if (r == "remove") roleOf.erase(m);
            else if (r == "editor" || r == "admin") roleOf[m] = "editor";  // "admin" = legacy alias
            else if (r == "viewer") roleOf[m] = "viewer";
        } else if (e.type == ET::EVENT_PUT) {
            std::string id = e.payload.value("id", std::string());
            if (id.empty() || tombstones.count(id)) continue;   // tombstone terminal
            bool exists = creatorOf.count(id) > 0;
            if (!exists) { if (!canAdd(author, verified)) continue; creatorOf[id] = author; }  // create
            else if (!canEditExisting(author, creatorOf[id], verified)) continue;              // edit
            json ev = e.payload;
            ev["calendarId"] = calId;
            ev["creatorId"] = creatorOf[id];               // ORIGINAL author (not the last editor)
            events[id] = ev;
        } else if (e.type == ET::EVENT_DEL) {
            std::string id = e.payload.value("id", std::string());
            if (id.empty()) continue;
            std::string creator = creatorOf.count(id) ? creatorOf[id] : std::string();
            if (!canEditExisting(author, creator, verified)) continue;
            tombstones.insert(id); events.erase(id);
        } else if (e.type == ET::EVENT_RSVP) {
            // Self-scoped attendance (ADR 0021): any verified member sets THEIR OWN status
            // (author = signer), LWW per (eventId, author) — HLC-ordered pass overwrites. "" = retract.
            std::string eid = e.payload.value("eventId", std::string());
            if (eid.empty()) continue;
            std::string status = e.payload.value("status", std::string());
            if (status.empty()) rsvpOf[eid].erase(author);
            else rsvpOf[eid][author] = status;
        } else if (e.type == ET::EXT) {
            // Generic extension (ADR 0021). Any verified member may CREATE (its own id); a SUPERSEDE
            // (same id) is honoured only from the creator or an editor/owner. `data` opaque to Scala.
            const json& p = e.payload;
            std::string id = p.value("id", std::string());
            std::string target = p.value("target", std::string());
            if (id.empty() || target.empty() || extTomb.count(id)) continue;   // need id+target; tombstone terminal
            auto cit = extCreator.find(id);
            json data = p.contains("data") ? p["data"] : json(nullptr);
            if (cit == extCreator.end()) {
                extCreator[id] = author;
                extItem[id] = ExtItem{p.value("ns", std::string()), p.value("kind", std::string()),
                                      target, id, author, e.hlc, data};
            } else {
                if (author != cit->second && !isEditor(author, verified)) continue; // supersede: creator/editor only
                ExtItem& it = extItem[id];   // keep ns/kind/target/author from creation; advance data+hlc
                it.data = data; it.hlc = e.hlc;
            }
        } else if (e.type == ET::EXT_DEL) {
            // Tombstone an ext item — by its author (creator) OR an owner/editor (moderation). Terminal.
            std::string id = e.payload.value("id", std::string());
            auto cit = extCreator.find(id);
            if (id.empty() || cit == extCreator.end()) continue;   // unknown id → nothing to authorise/delete
            if (author != cit->second && !isEditor(author, verified)) continue;
            extTomb.insert(id); extItem.erase(id);
        }
    }

    // Attach RSVPs to surviving events only (author keys sorted via std::map — matches the TS fold).
    for (auto& kv : rsvpOf) {
        auto it = events.find(kv.first);
        if (it == events.end() || kv.second.empty()) continue;
        json rsvps = json::object();
        for (auto& r : kv.second) rsvps[r.first] = r.second;
        it->second["rsvps"] = rsvps;
    }

    json evArr = json::array();
    for (auto& kv : events) evArr.push_back(kv.second);
    json roles = json::object();
    for (auto& kv : roleOf) roles[kv.first] = kv.second;

    // Materialize ext grouped by target. Array ORDER is significant for parity (the golden test
    // compares arrays element-wise), so sort each target's items by HLC then id — total + identical
    // to the TS fold. Empty targets are omitted.
    std::map<std::string, std::vector<const ExtItem*>> extByTarget;
    for (auto& kv : extItem) extByTarget[kv.second.target].push_back(&kv.second);
    json ext = json::object();
    for (auto& kv : extByTarget) {
        auto& v = kv.second;
        std::sort(v.begin(), v.end(), [](const ExtItem* a, const ExtItem* b) {
            int c = compareHlc(a->hlc, b->hlc); return c != 0 ? c < 0 : a->id < b->id;
        });
        json arr = json::array();
        for (const ExtItem* it : v)
            arr.push_back(json{{"ns", it->ns}, {"kind", it->kind}, {"id", it->id}, {"author", it->author},
                               {"hlc", {{"wall", it->hlc.wall}, {"ctr", it->hlc.ctr}, {"dev", it->hlc.dev}}},
                               {"data", it->data}});
        ext[kv.first] = arr;
    }

    return json{{"id", calId}, {"name", name}, {"color", color},
                {"description", description}, {"schema", schema},
                {"owner", owner}, {"roles", roles}, {"rolesConfigured", rolesConfigured},
                {"open", openCal}, {"collab", collabCal}, {"events", evArr}, {"ext", ext}};
}

} // namespace scala
