#include "scala_impl.h"
#include "qrcodegen.hpp"

// Generated umbrella: modules() + typed dependency wrappers (delivery_module)
#include "logos_sdk.h"

#include "calendar_store.h"
#include "calendar_sync.h"

#include <nlohmann/json.hpp>
#include "logos_transport.hpp"
#include "logos_sync/catchup.hpp"   // delta catch-up (buildRequest / answerRequest)
#include "logos_sync/snapshot.hpp"  // ADR 0020: deterministic log snapshots (epoch cut + serialize)
#include <QTimer>                    // catch-up retry timers (mesh forms ~10s after start)

#include <chrono>
#include <random>
#include <cstdlib>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <filesystem>
#include <sstream>
#include <vector>
#include <cctype>
#include <cstring>
#include <ifaddrs.h>       // shrooms-mesh auto-detect (getifaddrs)
#include <net/if.h>
#include <netinet/in.h>
#include <arpa/inet.h>

using scala::json;

// Detect a shrooms overlay-mesh address: the mesh presents itself as `logos*` interfaces
// (logos01/logos02) carrying a global ULA IPv6 (fc00::/7, e.g. fdb0:…). Returns that address
// (string) when this host is on the mesh, else "" — used to ride the mesh for Storage without
// a public IP or relay. Link-local (fe80::/10) is skipped.
static std::string detectShroomsMeshIPv6() {
    struct ifaddrs* ifas = nullptr;
    if (getifaddrs(&ifas) != 0) return "";
    std::string found;
    for (struct ifaddrs* ifa = ifas; ifa; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_INET6) continue;
        if (!ifa->ifa_name || std::strncmp(ifa->ifa_name, "logos", 5) != 0) continue;
        auto* sa = reinterpret_cast<struct sockaddr_in6*>(ifa->ifa_addr);
        const unsigned char* b = sa->sin6_addr.s6_addr;
        if (b[0] == 0xfe && (b[1] & 0xc0) == 0x80) continue;   // skip link-local fe80::/10
        if ((b[0] & 0xfe) != 0xfc) continue;                    // ULA fc00::/7 only
        char buf[INET6_ADDRSTRLEN] = {0};
        if (inet_ntop(AF_INET6, &sa->sin6_addr, buf, sizeof(buf))) { found = buf; break; }
    }
    freeifaddrs(ifas);
    return found;
}

// ── small helpers ────────────────────────────────────────────────────────────
// RFC-4122-ish v4 UUID. MUST use a properly-seeded high-quality RNG: std::rand()
// is deterministic when unseeded (replays the same sequence from seed 1 every
// process launch), so unseeded it hands the FIRST calendar/event after each
// restart an IDENTICAL id → colliding calendars (shared log/key/color) and, worse,
// re-used event ids that appendEvent's dedup-by-id silently DROPS. Seed once from
// random_device; nonce hex nibbles from a persistent 64-bit Mersenne Twister.
static std::string generateUuid() {
    static std::mt19937_64 rng(std::random_device{}());
    static std::uniform_int_distribution<int> hex(0, 15);
    std::ostringstream oss;
    oss << std::hex;
    for (int i = 0; i < 32; i++) {
        int r = hex(rng);
        if (i == 8 || i == 12 || i == 16 || i == 20) oss << '-';
        if (i == 12) oss << '4';
        else if (i == 16) oss << (8 + (r & 3));
        else oss << r;
    }
    return oss.str();
}
static long long nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch()).count();
}
static std::string stableIdentity() {
    std::ifstream f("/etc/machine-id");
    std::string id; if (f) std::getline(f, id);
    if (id.empty()) id = "scala-" + std::to_string(nowMs());
    return "scala-" + id.substr(0, 16);
}
// base64url (RFC 4648, no padding) — matches the mobile invite key encoding.
static const char* kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
static std::string b64urlEncode(const std::string& in) {
    std::string out; int val = 0, bits = -6;
    for (unsigned char c : in) { val = (val << 8) + c; bits += 8;
        while (bits >= 0) { out.push_back(kB64[(val >> bits) & 0x3F]); bits -= 6; } }
    if (bits > -6) out.push_back(kB64[((val << 8) >> (bits + 8)) & 0x3F]);
    return out;
}
static std::string b64urlDecode(const std::string& in) {
    std::vector<int> T(256, -1); for (int i = 0; i < 64; i++) T[(unsigned char)kB64[i]] = i;
    std::string out; int val = 0, bits = -8;
    for (unsigned char c : in) { if (T[c] == -1) continue; val = (val << 6) + T[c]; bits += 6;
        if (bits >= 0) { out.push_back(char((val >> bits) & 0xFF)); bits -= 8; } }
    return out;
}
static std::string urlEncode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF"; std::string o;
    for (unsigned char c : s) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o.push_back(c);
        else { o.push_back('%'); o.push_back(hex[c >> 4]); o.push_back(hex[c & 15]); }
    }
    return o;
}
static std::string urlDecode(const std::string& s) {
    std::string o;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size()) { o.push_back((char)std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16)); i += 2; }
        else if (s[i] == '+') o.push_back(' ');
        else o.push_back(s[i]);
    }
    return o;
}
static std::map<std::string, std::string> parseQuery(const std::string& link) {
    std::map<std::string, std::string> q;
    auto pos = link.find('?'); if (pos == std::string::npos) return q;
    std::string qs = link.substr(pos + 1); std::stringstream ss(qs); std::string pair;
    while (std::getline(ss, pair, '&')) {
        auto eq = pair.find('=');
        if (eq == std::string::npos) continue;
        q[urlDecode(pair.substr(0, eq))] = urlDecode(pair.substr(eq + 1));
    }
    return q;
}

// ── construction ─────────────────────────────────────────────────────────────
ScalaImpl::ScalaImpl() {
    m_store = new CalendarStore();
    m_sync = new CalendarSync();
    // CRDT path: a received event's raw JSON is merged into that calendar's log.
    m_sync->setEventHandler([this](const std::string& calId, const std::string& eventJson) {
        applyIncoming(calId, eventJson);
    });
    m_sync->setStatusHandler([this](const std::string& calId, const std::string& status) {
        syncStatusChanged(calId, status);
    });
}
ScalaImpl::~ScalaImpl() { if (m_resyncTimer) { m_resyncTimer->stop(); m_resyncTimer->deleteLater(); m_resyncTimer = nullptr; } delete m_sync; delete m_store; }

// ── HLC + event helpers ──────────────────────────────────────────────────────
scala::HLC ScalaImpl::nextHlc() {
    long long t = nowMs();
    if (t > m_wall) { m_wall = t; m_ctr = 0; } else { m_ctr += 1; }
    return scala::HLC{ m_wall, m_ctr, m_identity };
}
scala::Event ScalaImpl::mkEvent(const std::string& type, const json& payload, const std::string& calId) {
    scala::Event e; e.v = 1; e.id = generateUuid(); e.type = type; e.payload = payload;
    // Author through loam_core's identity service (loam ADR 0004): the container's bound identity
    // signs; keys never leave loam. This is why the calendar owner is a loam identity, not scala's
    // old device key. Falls back to the local key so scala keeps working if loam_core can't sign.
    if (!calId.empty()) {
        std::string signer, sigHex, pubHex;
        try {
            std::string ir = modules().loam_core.identityForContainer(calId); // sync caller → JSON string
            if (!ir.empty()) {
                json meta = json::parse(ir, nullptr, false);
                if (meta.is_object()) signer = meta.value("address", std::string());
            }
        } catch (...) {}
        if (!signer.empty()) {
            e.dev = signer; e.hlc = nextHlc(); e.hlc.dev = signer;
            std::string digestHex = scala::toHexS(scala::sha256b(scala::strBytes(scala::canonicalMessage(e))).data(), 32);
            try {
                std::string sr = modules().loam_core.signDigest(calId, digestHex); // sync caller → JSON string
                if (!sr.empty()) {
                    json sres = json::parse(sr, nullptr, false);
                    std::string sg = sres.is_object() ? sres.value("sig", std::string()) : std::string();
                    std::string pk = sres.is_object() ? sres.value("pub", std::string()) : std::string();
                    if (!sg.empty() && !pk.empty()) {
                        e.pub = pk; e.sig = sg;
                        return e; // signed by the loam identity
                    }
                }
            } catch (...) {}
        }
    }
    // Fallback: local device key (original behaviour) — keeps authoring working without loam_core.
    e.hlc = nextHlc(); e.dev = m_identity;
    if (m_signId.valid) scala::signEvent(m_signId, e);
    return e;
}
void ScalaImpl::publishAndApply(const std::string& calId, const scala::Event& e) {
    m_store->appendEvent(calId, e);                        // persist locally first
    m_sync->sendEvent(calId, scala::eventToJson(e).dump()); // then broadcast (no-op if not syncing)
}

// ── keycard-aware authoring (scala ADR 0016) ─────────────────────────────────
void ScalaImpl::emitKcStatus(const std::string& calId, const std::string& ref,
                             const char* purpose, const char* phase, const std::string& error) {
    json s{{"purpose", purpose}, {"phase", phase}, {"ref", ref}, {"calId", calId},
           {"active", std::string(phase) == "pending"}};
    if (!error.empty()) s["error"] = error;
    m_kcState = s.dump();               // poll snapshot for the view (basecamp 0.2.0 is poll-based)
    keycardStatus(calId, ref, s.dump()); // + the event, for event-capable hosts
}

std::string ScalaImpl::keycardState() { return m_kcState; }

// If calId is bound to a KEYCARD identity, build the unsigned event, request an on-card signature
// via loam_core (async), park it keyed by its id, and return true. The signature arrives on
// onKeycardSignResult, which attaches it and publishes. Returns false for device/soft identities.
bool ScalaImpl::authorEvent(const std::string& type, const json& payload, const std::string& calId) {
    if (calId.empty()) return false;
    std::string kind, signer, domain;
    try {
        json meta = json::parse(modules().loam_core.identityForContainer(calId), nullptr, false);
        if (meta.is_object()) { kind = meta.value("kind", std::string()); signer = meta.value("address", std::string()); }
    } catch (...) {}
    if (kind != "keycard" || signer.empty()) return false;

    scala::Event e; e.v = 1; e.id = generateUuid(); e.type = type; e.payload = payload;
    e.dev = signer; e.hlc = nextHlc(); e.hlc.dev = signer;   // author = the card's address (same as fold sees)
    std::string digestHex = scala::toHexS(scala::sha256b(scala::strBytes(scala::canonicalMessage(e))).data(), 32);
    const std::string ref = e.id;
    m_pendingKc[ref] = PendingKc{calId, e};
    emitKcStatus(calId, ref, "event", "pending", "");
    try { modules().loam_core.keycardSign(calId, digestHex, ref); }
    catch (...) { m_pendingKc.erase(ref); emitKcStatus(calId, ref, "event", "failed", "keycard call failed"); }
    return true;
}

void ScalaImpl::authorAndPublish(const std::string& type, const json& payload, const std::string& calId) {
    if (authorEvent(type, payload, calId)) return;             // keycard: async, publishes on the tap
    publishAndApply(calId, mkEvent(type, payload, calId));     // device/soft: sign + publish now
}

std::string ScalaImpl::enrollKeycard(const std::string& label, const std::string& domain) {
    const std::string dom = domain.empty() ? std::string("scala") : domain;
    const std::string ref = "enroll:" + dom + ":" + generateUuid();
    emitKcStatus("", ref, "enroll", "pending", "");
    try { modules().loam_core.enrollKeycard(label.empty() ? dom : label, dom, ref); }
    catch (...) { emitKcStatus("", ref, "enroll", "failed", "enroll call failed"); }
    return ref;
}
void ScalaImpl::applyIncoming(const std::string& calId, const std::string& eventJson) {
    json j = json::parse(eventJson, nullptr, false);
    if (j.is_discarded() || !j.is_object()) return;
    scala::Event e = scala::eventFromJson(j);
    if (e.id.empty()) return;
    // CATCH-UP: a peer publishing the ids it holds (SYNC_REQ) — serve only the
    // delta, don't store the request itself.
    if (e.type == scala::ET::SYNC_REQ) { onSyncReq(calId, e.payload); return; }
    m_store->appendEvent(calId, e);   // idempotent (dedup by id); the view's poll refolds
    cacheAttachments(e);              // ADR 0017: pull+pin any attachment CID we lack → we now serve it too
}

// Step the catch-up state machine for one incoming SYNC_REQ. `msg` is a single
// RBSR range statement (fp/ids/need); respond() self-ignores our own `from` and
// returns the exact events to serve plus the reply messages to publish. Recursive
// Range-Based Set Reconciliation (logos-sync ADR 0004): only the id-exact delta is
// transferred and every message is single-segment, so there's no whole-log serve
// and no flood throttle to add — the exchange self-terminates on convergence.
void ScalaImpl::onSyncReq(const std::string& calId, const json& msg) {
    auto step = logos_sync::catchup::respond(m_store->log(calId), msg, m_identity);
    for (const auto& ev : step.serve)                              // the missing events, exactly
        m_sync->sendEvent(calId, scala::eventToJson(ev).dump());
    for (const auto& r : step.replies)                            // fp/ids/need range replies
        m_sync->sendEvent(calId, scala::eventToJson(mkEvent(scala::ET::SYNC_REQ, r)).dump());
}

// Kick off catch-up: publish the initial reconciliation message (a bounded set of
// range fingerprints over what we hold). A fresh calendar sends an empty-set
// fingerprint and recurses down to receive everything; a slightly-behind one
// converges on just the changed range.
void ScalaImpl::sendSyncReq(const std::string& calId) {
    json m = logos_sync::catchup::buildInitial(m_store->log(calId), m_identity);
    m_sync->sendEvent(calId, scala::eventToJson(mkEvent(scala::ET::SYNC_REQ, m)).dump());
}

// ── context lifecycle ────────────────────────────────────────────────────────
void ScalaImpl::onContextReady() {
    // Identity (SDS senderId + event author) — persisted so it's stable.
    // Signing identity: load the persisted secp256k1 private key, or generate one on
    // first run. m_identity is the derived address ("0x…") — the verifiable author id.
    {
        std::string privHex = m_store->kvGet("sign_key");
        if (!privHex.empty()) m_signId = scala::identityFromPriv(scala::fromHexB(privHex));
        if (!m_signId.valid) {
            m_signId = scala::generateIdentity();
            if (m_signId.valid) m_store->kvSet("sign_key", scala::toHexS(m_signId.priv.data(), 32));
        }
        m_identity = m_signId.valid ? m_signId.address : m_store->kvGet("identity");
        if (m_identity.empty()) { m_identity = stableIdentity(); }
        m_store->kvSet("identity", m_identity);
    }

    using LogosMap = nlohmann::json;
    using Tx = logos_transport::Transport<LogosMap>;

    // Route the Transport through the loam_core FACADE instead of delivery_module directly (ADR
    // 0015). loam_core.start() does createNode+start together and returns EARLY, so node readiness
    // arrives via statusChanged("Connected") — we latch the createNode cb on the first Connected.
    // The double-b64 wire is byte-identical to the direct-delivery path (loam_core's delivery
    // bearer re-applies the same framing), so scala<->scala and scala<->mobile interop hold; and
    // every write also fans onto the ble_mesh bearer, deduped by frameId. (loam_core methods
    // return a status string, so these callbacks take std::string, not StdLogosResult.)
    Tx::Ops ops;
    ops.createNode = [this](const std::string& cfg, Tx::Cb cb) {
        modules().loam_core.setSenderIdAsync(m_identity.empty() ? std::string("scala-default") : m_identity,
                                             [](std::string) {});
        auto fired = std::make_shared<bool>(false);
        modules().loam_core.onStatusChanged([this, cb, fired](const std::string& s) {
            if (s != "Connected") return;
            if (!*fired) { *fired = true; cb(true, ""); return; }
            // A RECONNECT ("Connected" again after a drop, or the mesh only NOW has peers). Re-advertise
            // our id-set so a backlog authored while the node wasn't meshed reaches peers WITHOUT a manual
            // Basecamp restart — that restart-to-sync was the gap. This fires off the loam_core status
            // string, so it works even if m_sync->ready() is stale; sendSyncReq no-ops if we still can't
            // send, so repeating it is safe.
            for (const auto& c : m_store->calendars()) sendSyncReq(c.id);
        });
        modules().loam_core.startAsync(cfg, [](std::string err) {
            if (!err.empty()) fprintf(stderr, "[scala] loam_core.start: %s\n", err.c_str());
        });
    };
    ops.start = [this](Tx::Cb cb) { cb(true, ""); };   // loam_core.start already did createNode+start
    ops.subscribe = [this](const std::string& t, Tx::Cb cb) {
        modules().loam_core.joinAsync(t, [cb](std::string) { cb(true, ""); });
    };
    ops.channelCreate = [this](const std::string&, const std::string&, const std::string&, Tx::Cb cb) {
        cb(true, "");   // loam_core.join() already subscribes + creates the SDS channel with our senderId
    };
    ops.channelSend = [this](const std::string& id, const LogosMap& payload, Tx::Cb cb) {
        // `payload` is bytesPayload(b64) — a byte-ARRAY LogosMap of the b64 string (or a string in
        // the string repr). Recover the b64 and hand it to loam_core.sendSealed, which re-applies
        // the same double-b64 wire and fans to every bearer.
        std::string b64;
        if (payload.is_string()) b64 = payload.get<std::string>();
        else if (payload.is_array()) { for (const auto& c : payload) if (c.is_number_integer()) b64.push_back((char)c.get<int>()); }
        modules().loam_core.sendSealedAsync(id, b64, [cb](std::string) { cb(true, ""); });
    };
    ops.onMessage = [this](Tx::RecvCb handler) {
        // loam_core hands payloadB64 = b64(<what we sent>); wrap it as a JSON STRING LogosMap so the
        // Transport's toWire() returns it and decodes once — identical to the delivery path.
        modules().loam_core.onReceived(
            [handler](const std::string& topic, const std::string&, const std::string& payloadB64, int64_t) {
                handler(topic, LogosMap(payloadB64));
            });
    };
    ops.onChannelMessage = [this](Tx::RecvCb) { /* loam_core.onReceived covers both — avoid double-deliver */ };

    Tx tx(std::move(ops),
          Tx::Config{
              .logLevel = "INFO",
              .preset = "logos.test",   // logos.dev migrated to cluster 3; logos.test = cluster 2
              // entryNodes intentionally empty: delivery v0.2.0 discovers the fleet via discv5
              // from the preset (the transport builds messagingOverrides with discv5-udp-port).
              .useChannels = true,
              .hubMode = false,
              .deviceId = m_identity.empty() ? std::string("scala-default") : m_identity,
          },
          // topics: every calendar in the registry has a channel.
          [this]{ std::vector<std::string> topics;
                  for (const auto& c : m_store->calendars())
                      topics.push_back(CalendarSync::topicForCalendar(c.id));
                  return topics; },
          [this](const std::string& topic, const std::string& sealedOnceDecoded) {
              m_sync->handleReceive(topic, sealedOnceDecoded);
          },
          /*onReady*/ [this]{
              // Node connected: ask peers what we're missing. No blind whole-log
              // seed anymore — peers pull the delta via SYNC_REQ (logos-sync ADR 0003).
              for (const auto& c : m_store->calendars()) sendSyncReq(c.id);
          },
          /*setStatus*/ [this](const std::string& s) { m_deliveryStatus = s; });

    m_sync->setTransport(std::move(tx));
    m_ctxReady = true;

    // Register each calendar's key so seal/open + channel joins work after a restart.
    for (const auto& c : m_store->calendars())
        if (!c.key.empty()) m_sync->startSync(c.id, c.key);

    m_sync->bootstrap();

    // Catch-up retry: start() finishes BEFORE the gossip mesh has peers (~10s to
    // form) and before the async subscribe/channel-join land, so a single SYNC_REQ
    // at onReady races into the void (this was the "history never arrives" bug).
    // Re-request at 3/10/25s (logos-sync ADR 0004). QTimers created here fire on the
    // module's event-loop thread; sendSyncReq is a no-op until the node is ready.
    for (int ms : {3000, 10000, 25000})
        QTimer::singleShot(ms, [this]{
            if (m_sync)   // no ready() gate: sendSyncReq self-no-ops if the node can't send yet, and a
                for (const auto& c : m_store->calendars()) sendSyncReq(c.id);   // stale ready() must not suppress catch-up
        });

    // PERIODIC catch-up (parity with qaku_core's m_hubTimer): the 3/10/25s ladder only covers
    // mesh warm-up. A message dropped AFTER that window (and outside a join) was never re-reconciled
    // until a restart — the reliability gap. Re-request the RBSR delta for every calendar every 30s
    // so drops recover on their own. sendSyncReq is a bounded fp frame (no whole-log flood).
    if (!m_resyncTimer) {
        m_resyncTimer = new QTimer();
        QObject::connect(m_resyncTimer, &QTimer::timeout, m_resyncTimer, [this]{
            if (m_sync)   // no ready() gate (see the ladder above): a stale ready() must not stop the 30s re-serve
                for (const auto& c : m_store->calendars()) sendSyncReq(c.id);
        });
        m_resyncTimer->start(30000);
    }

    // Keycard authoring (scala ADR 0016): loam_core signs a keycard-owned write asynchronously (card
    // tap in keycard-ui) and delivers the result here, matched by ref. For a parked EVENT we attach
    // {sig,pub} and publish; an ENROL ref (no parked event) just surfaces its status to the view.
    modules().loam_core.onKeycardSignResult([this](const std::string& ref, const std::string& resultJson) {
        json r = json::parse(resultJson, nullptr, false);
        const bool err = !r.is_object() || r.contains("error");
        const std::string emsg = r.is_object() ? r.value("error", std::string()) : std::string("bad result");
        auto it = m_pendingKc.find(ref);
        if (it == m_pendingKc.end()) {   // enrol (or an already-resolved ref)
            emitKcStatus("", ref, "enroll", err ? "failed" : "done", emsg);
            return;
        }
        PendingKc pk = it->second; m_pendingKc.erase(it);
        // A keycard write that never got signed: if the calendar has NO applied events, it's an empty
        // orphan from a create whose first cal.meta never landed (cancelled/failed tap). Remove it so a
        // failed keycard create leaves nothing behind, instead of a name-only ghost calendar. (Only
        // keycard calendars can be event-less; device/soft author cal.meta synchronously at create.)
        auto cleanupOrphan = [this, &pk] { if (m_store->log(pk.calId).empty()) { m_sync->stopSync(pk.calId); m_store->removeCalendar(pk.calId); } };
        if (err) { cleanupOrphan(); emitKcStatus(pk.calId, ref, "event", "failed", emsg); return; }
        pk.event.pub = r.value("pub", std::string());
        pk.event.sig = r.value("sig", std::string());
        if (pk.event.pub.empty() || pk.event.sig.empty()) { cleanupOrphan(); emitKcStatus(pk.calId, ref, "event", "failed", "empty signature"); return; }
        publishAndApply(pk.calId, pk.event);          // now it's a fully-signed event
        emitKcStatus(pk.calId, ref, "event", "done", "");
    });

    ensureStorage();   // bring up the Logos Storage node (attachments cache/provider) — ADR 0017
}

void ScalaImpl::ensureDelivery() { if (m_sync) m_sync->bootstrap(); }

// ── identity ─────────────────────────────────────────────────────────────────
// Keep in sync with metadata.json "version". The view compares this to the minimum it needs and
// shows an "update the scala core" banner if the core is older (or lacks this method entirely).
std::string ScalaImpl::coreVersion() const { return "0.9.27"; }
std::string ScalaImpl::getIdentity() const { return m_identity; }
void ScalaImpl::setIdentity(const std::string& pubkeyHex) {
    if (m_identity != pubkeyHex) { m_identity = pubkeyHex; m_store->kvSet("identity", m_identity); identityChanged(); }
}
void ScalaImpl::setNamespace(const std::string&) { /* isolation is via SCALA_CORE_DATA now */ }

// ── calendars ────────────────────────────────────────────────────────────────
std::string ScalaImpl::createCalendar(const std::string& name, const std::string& color, const std::string& identityId) {
    // Guard against ever reusing a calendar id. With the seeded RNG a collision is
    // ~2^-122 (never), but a duplicate id would silently share a log/key with an
    // existing calendar — regenerate until unambiguously fresh.
    std::string id;
    do { id = generateUuid(); } while (!m_store->calendar(id).id.empty());
    std::string key = generateUuid() + generateUuid();   // 72-char dashed, same as mobile
    m_store->upsertCalendar({ id, key, name, color });
    m_sync->startSync(id, key);
    // Bind the chosen identity in loam_core BEFORE authoring cal.meta, so the OWNER (the first
    // cal.meta's author) IS that identity (loam ADR 0004). Empty → the default identity.
    // Bind the chosen identity, or (none passed) the CURRENT DEFAULT — at the core, so a new calendar
    // reliably owns the identity the user picked even if the view sends nothing (stale QML). loam only
    // suppresses a keycard DEFAULT for UNBOUND legacy containers; an explicit bind here is honored, so
    // this is how a keycard-default user gets a keycard-owned calendar without hijacking old ones.
    std::string bindId = identityId;
    if (bindId.empty()) { try { json d = json::parse(modules().loam_core.getDefaultIdentityId(), nullptr, false);
        if (d.is_string()) bindId = d.get<std::string>(); } catch (...) {} }   // getDefaultIdentityId returns a JSON-quoted string
    if (!bindId.empty()) { try { modules().loam_core.bindContainer(id, bindId); } catch (...) {} }
    authorAndPublish(scala::ET::CAL_META, json{{"name", name}, {"color", color}}, id);
    return id;
}
// #7/#8: edit shared calendar metadata — {name?,color?,description?,schema?,open?} (LWW cal.meta).
bool ScalaImpl::updateCalendarMeta(const std::string& calId, const std::string& fieldsJson) {
    json in = json::parse(fieldsJson, nullptr, false);
    if (in.is_discarded() || !in.is_object()) return false;
    json p = json::object();
    for (const char* k : {"name", "color", "description"})
        if (in.contains(k) && in[k].is_string()) p[k] = in[k];
    if (in.contains("schema") && in["schema"].is_array()) p["schema"] = in["schema"];
    if (in.contains("open") && in["open"].is_boolean()) p["open"] = in["open"];  // Open/Restricted toggle (two-rule perms)
    if (in.contains("collab") && in["collab"].is_boolean()) p["collab"] = in["collab"];  // Collaborative editing toggle
    if (p.empty()) return false;
    authorAndPublish(scala::ET::CAL_META, p, calId);
    return true;
}
// #3: grant/revoke a member by identity — role is "admin"|"viewer"|"remove". The fold
// admits this only if WE are owner/admin, so a viewer calling it is a no-op everywhere.
bool ScalaImpl::setMemberRole(const std::string& calId, const std::string& member, const std::string& role) {
    if (member.empty()) return false;
    authorAndPublish(scala::ET::MEMBER_SET, json{{"member", member}, {"role", role}}, calId);
    return true;
}
bool ScalaImpl::manageMember(const std::string& jsonArg) {
    json in = json::parse(jsonArg, nullptr, false);
    if (in.is_discarded() || !in.is_object()) return false;
    return setMemberRole(in.value("calId", std::string()), in.value("member", std::string()), in.value("role", std::string()));
}
// #4: per-event edit history — every event.put/del touching this id, in log order,
// as [{author,at,action,payload}]. Reads the raw log (not the fold) so nothing collapses.
std::string ScalaImpl::getEventHistory(const std::string& calId, const std::string& eventId) {
    // Friendly label per payload field, for a cheap "what changed" on each edit (#4). Order preserved
    // to match the mobile getEventHistory (title, time, all-day, …).
    static const std::vector<std::pair<const char*, const char*>> LBL = {
        {"title", "title"}, {"startTime", "time"}, {"endTime", "time"}, {"allDay", "all-day"},
        {"location", "location"}, {"url", "link"}, {"description", "notes"}, {"recur", "repeat"},
        {"reminderMin", "reminder"}, {"fields", "details"}};
    json out = json::array();
    json prev; bool havePrev = false;
    for (const auto& e : m_store->log(calId)) {
        if (!e.payload.is_object() || e.payload.value("id", std::string()) != eventId) continue;
        std::string action = e.type == scala::ET::EVENT_DEL ? "deleted"
                           : (out.empty() ? "created" : "edited");
        json entry = json{{"author", e.dev}, {"at", e.hlc.wall}, {"action", action}, {"payload", e.payload}};
        if (action == "edited" && havePrev) {
            json changed = json::array(); std::set<std::string> seen;
            for (const auto& kv : LBL) {
                json a = prev.contains(kv.first) ? prev[kv.first] : json(nullptr);
                json b = e.payload.contains(kv.first) ? e.payload[kv.first] : json(nullptr);
                if (a != b && !seen.count(kv.second)) { seen.insert(kv.second); changed.push_back(kv.second); }
            }
            entry["changed"] = changed;
        }
        out.push_back(entry);
        prev = e.payload; havePrev = true;
    }
    return out.dump();
}
// ADR 0021: set MY attendance on an event. Self-scoped (author = signer); no add/edit role needed,
// so it does not gate on canAdd/canEditExisting — the fold accepts any verified RSVP.
std::string ScalaImpl::setRsvp(const std::string& calendarId, const std::string& eventId, const std::string& status) {
    json p; p["eventId"] = eventId; p["status"] = status;
    authorAndPublish(scala::ET::EVENT_RSVP, p, calendarId);
    return "ok";
}
std::string ScalaImpl::listCalendars() {
    ensureDelivery();   // kym self-drive
    json arr = json::array();
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        std::string nm = f.value("name", std::string()); if (nm.empty()) nm = c.name;
        std::string col = f.value("color", std::string()); if (col.empty()) col = c.color;
        // Resolve the calendar's authoring identity ADDRESS here (once), so the view gets it in this
        // single listCalendars call instead of making one blocking loam IPC per calendar in refresh().
        std::string authorAddr;
        try { json im = json::parse(modules().loam_core.identityForContainer(c.id), nullptr, false);
              if (im.is_object()) authorAddr = im.value("address", std::string()); } catch (...) {}
        arr.push_back(json{{"id", c.id}, {"name", nm}, {"color", col}, {"authorAddr", authorAddr},
                           {"isShared", true}, {"encryptionKey", c.key}, {"creatorId", m_identity},
                           // #7/#8/#3: surface description, custom-field schema and roles to the view.
                           {"description", f.value("description", std::string())},
                           {"schema", f.value("schema", json::array())},
                           {"owner", f.value("owner", std::string())},
                           {"roles", f.value("roles", json::object())},
                           {"rolesConfigured", f.value("rolesConfigured", false)},
                           // Surface the Open/Restricted flag so the view's toggle + canAddTo see it
                           // (without this it reads `undefined` → always "open", and the toggle snaps back).
                           {"open", f.value("open", true)},
                           {"collab", f.value("collab", false)}});
    }
    return arr.dump();
}
// All events across ALL calendars in ONE call (each tagged with calendarId), so refresh() doesn't
// make a blocking listEvents IPC per calendar. The view filters/expands client-side.
std::string ScalaImpl::listAllEvents() {
    ensureDelivery();
    json out = json::array();
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        for (auto& ev : f["events"]) { ev["calendarId"] = c.id; out.push_back(ev); }
    }
    return out.dump();
}
bool ScalaImpl::deleteCalendar(const std::string& id) {
    m_sync->stopSync(id); m_store->removeCalendar(id); return true;
}

// ── events ───────────────────────────────────────────────────────────────────
std::string ScalaImpl::createEvent(const std::string& calendarId, const std::string& eventJson) {
    json p = json::parse(eventJson, nullptr, false);
    if (p.is_discarded() || !p.is_object()) return "";
    p["id"] = generateUuid();
    p.erase("calendarId"); p.erase("creatorId");   // set by the fold
    authorAndPublish(scala::ET::EVENT_PUT, p, calendarId);
    return p["id"].get<std::string>();
}
std::string ScalaImpl::createEventAt(const std::string& calendarId, const std::string& title,
                                     const std::string& startMs, const std::string& endMs) {
    long long start = 0, end = 0;
    try { start = std::stoll(startMs); } catch (...) { return ""; }
    try { end = endMs.empty() ? start + 3600000 : std::stoll(endMs); } catch (...) { end = start + 3600000; }
    json p;
    p["id"] = generateUuid();
    p["title"] = title;
    p["startTime"] = start;
    p["endTime"] = end;
    authorAndPublish(scala::ET::EVENT_PUT, p, calendarId);
    return p["id"].get<std::string>();
}
std::string ScalaImpl::updateEvent(const std::string& eventJson) {
    json p = json::parse(eventJson, nullptr, false);
    if (p.is_discarded() || !p.is_object() || !p.contains("id")) return "";
    std::string calId = p.value("calendarId", std::string());
    if (calId.empty()) return "";
    std::string id = p["id"].get<std::string>();
    p.erase("calendarId"); p.erase("creatorId");
    authorAndPublish(scala::ET::EVENT_PUT, p, calId);
    return id;
}
bool ScalaImpl::deleteEvent(const std::string& id) {
    // find which calendar owns the event (fold each calendar).
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        for (const auto& ev : f["events"])
            if (ev.value("id", std::string()) == id) {
                authorAndPublish(scala::ET::EVENT_DEL, json{{"id", id}}, c.id);
                return true;
            }
    }
    return false;
}
std::string ScalaImpl::listEvents(const std::string& calendarId) {
    ensureDelivery();
    json f = scala::foldCalendar(calendarId, m_store->log(calendarId));
    return f["events"].dump();
}
std::string ScalaImpl::getEvent(const std::string& id) {
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        for (const auto& ev : f["events"]) if (ev.value("id", std::string()) == id) return ev.dump();
    }
    return "{}";
}
std::string ScalaImpl::searchEvents(const std::string& query) {
    json out = json::array();
    std::string q = query; for (auto& ch : q) ch = tolower(ch);
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        for (const auto& ev : f["events"]) {
            std::string hay = ev.value("title", std::string()) + " " + ev.value("description", std::string()) + " " + ev.value("location", std::string());
            for (auto& ch : hay) ch = tolower(ch);
            if (hay.find(q) != std::string::npos) out.push_back(ev);
        }
    }
    return out.dump();
}
// ── reminders + iCalendar helpers ────────────────────────────────────────────
namespace {
constexpr long long kNoUntil = 4102444800000LL;   // ~year 2100, "no UNTIL" sentinel

// Expand an event's occurrence start times (ms) overlapping [winStart, winEnd] — the same
// daily/weekly/monthly/yearly rule the QML view + mobile recur.ts use, via local calendar math.
std::vector<long long> expandOccurrences(const scala::json& ev, long long winStart, long long winEnd) {
    std::vector<long long> occ;
    if (!ev.contains("startTime") || !ev["startTime"].is_number()) return occ;
    long long start = ev["startTime"].get<long long>();
    long long end = (ev.contains("endTime") && ev["endTime"].is_number()) ? ev["endTime"].get<long long>() : start;
    long long dur = end > start ? end - start : 0;
    const scala::json* r = (ev.contains("recur") && ev["recur"].is_object()) ? &ev["recur"] : nullptr;
    std::string freq = r ? r->value("freq", std::string()) : std::string();
    if (freq.empty()) {
        if (start + dur >= winStart && start <= winEnd) occ.push_back(start);
        return occ;
    }
    int interval = 1;
    if (r->contains("interval") && (*r)["interval"].is_number()) { int iv = (*r)["interval"].get<int>(); interval = iv > 1 ? iv : 1; }
    long long until = (r->contains("until") && (*r)["until"].is_number()) ? (*r)["until"].get<long long>() : kNoUntil;
    std::time_t t = (std::time_t)(start / 1000); std::tm cur{}; localtime_r(&t, &cur);
    for (int guard = 0; guard < 5000; ++guard) {
        std::tm tmp = cur; tmp.tm_isdst = -1;
        long long occStart = (long long)std::mktime(&tmp) * 1000LL;
        if (occStart > winEnd || occStart > until) break;
        if (occStart + dur >= winStart) occ.push_back(occStart);
        if (freq == "daily")        cur.tm_mday += interval;
        else if (freq == "weekly")  cur.tm_mday += 7 * interval;
        else if (freq == "monthly") cur.tm_mon  += interval;
        else if (freq == "yearly")  cur.tm_year += interval;
        else break;
        cur.tm_isdst = -1; std::mktime(&cur);   // normalize (e.g. mday overflow → next month)
    }
    return occ;
}

std::string icsEscape(const std::string& s) {
    std::string o; o.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '\\': o += "\\\\"; break;
            case ';':  o += "\\;";  break;
            case ',':  o += "\\,";  break;
            case '\n': o += "\\n";  break;
            case '\r': break;
            default:   o += c;
        }
    }
    return o;
}
std::string icsUnescape(const std::string& s) {
    std::string o; o.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '\\' && i + 1 < s.size()) { char n = s[++i]; o += (n == 'n' || n == 'N') ? '\n' : n; }
        else o += s[i];
    }
    return o;
}
// Fold a content line to <=75 octets with CRLF + leading-space continuation (RFC 5545 §3.1).
std::string icsFold(const std::string& line) {
    std::string o; size_t n = 0;
    for (char c : line) { if (n >= 73) { o += "\r\n "; n = 1; } o += c; ++n; }
    return o;
}
std::string icsFmtUtc(long long ms) {
    std::time_t t = (std::time_t)(ms / 1000); std::tm g{}; gmtime_r(&t, &g);
    char buf[20]; std::strftime(buf, sizeof(buf), "%Y%m%dT%H%M%SZ", &g); return buf;
}
std::string icsFmtDate(long long ms) {   // all-day: the local calendar date
    std::time_t t = (std::time_t)(ms / 1000); std::tm lt{}; localtime_r(&t, &lt);
    char buf[12]; std::strftime(buf, sizeof(buf), "%Y%m%d", &lt); return buf;
}
// Parse an ICS date/date-time value → ms epoch. Sets allDay for a bare YYYYMMDD (VALUE=DATE).
// Handles YYYYMMDD (all-day, local midnight), YYYYMMDDTHHMMSSZ (UTC), YYYYMMDDTHHMMSS (floating→local).
long long icsParseDate(const std::string& value, bool& allDay) {
    std::string v = value; allDay = false;
    if (v.size() == 8 && v.find('T') == std::string::npos) {
        allDay = true; std::tm tmv{}; tmv.tm_isdst = -1;
        try { tmv.tm_year = std::stoi(v.substr(0,4)) - 1900; tmv.tm_mon = std::stoi(v.substr(4,2)) - 1; tmv.tm_mday = std::stoi(v.substr(6,2)); }
        catch (...) { return 0; }
        return (long long)std::mktime(&tmv) * 1000LL;
    }
    bool utc = (!v.empty() && v.back() == 'Z'); if (utc) v.pop_back();
    if (v.size() < 15 || v[8] != 'T') return 0;
    std::tm tmv{}; tmv.tm_isdst = -1;
    try {
        tmv.tm_year = std::stoi(v.substr(0,4)) - 1900; tmv.tm_mon = std::stoi(v.substr(4,2)) - 1; tmv.tm_mday = std::stoi(v.substr(6,2));
        tmv.tm_hour = std::stoi(v.substr(9,2)); tmv.tm_min = std::stoi(v.substr(11,2)); tmv.tm_sec = std::stoi(v.substr(13,2));
    } catch (...) { return 0; }
    return utc ? (long long)timegm(&tmv) * 1000LL : (long long)std::mktime(&tmv) * 1000LL;
}
} // namespace

std::string ScalaImpl::getPendingReminders() {
    long long now = nowMs();
    long long horizon = now + 1440LL * 60000LL;   // widest lead we offer is 1 day
    json out = json::array();
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        for (const auto& ev : f["events"]) {
            int lead = (ev.contains("reminderMin") && ev["reminderMin"].is_number()) ? ev["reminderMin"].get<int>() : 10;
            if (lead <= 0) continue;
            for (long long occ : expandOccurrences(ev, now, horizon)) {
                long long fireAt = occ - (long long)lead * 60000LL;
                if (now >= fireAt && now < occ) {
                    out.push_back(json{{"calendarId", c.id}, {"id", ev.value("id", std::string())},
                                       {"title", ev.value("title", std::string())}, {"startTime", occ},
                                       {"occ", occ}, {"reminderMin", lead}, {"location", ev.value("location", std::string())}});
                    break;   // one pending reminder per event is enough
                }
            }
        }
    }
    return out.dump();
}

std::string ScalaImpl::exportCalendarIcs(const std::string& calendarId) {
    scala::CalReg c = m_store->calendar(calendarId);
    if (c.id.empty()) return "";
    json f = scala::foldCalendar(c.id, m_store->log(c.id));
    std::string nm = f.value("name", std::string()); if (nm.empty()) nm = c.name.empty() ? std::string("Scala Calendar") : c.name;
    const std::string dtstamp = icsFmtUtc(nowMs());
    std::string out;
    out += "BEGIN:VCALENDAR\r\n";
    out += "VERSION:2.0\r\n";
    out += "PRODID:-//Scala//Secure CALendar//EN\r\n";
    out += "CALSCALE:GREGORIAN\r\n";
    out += icsFold("X-WR-CALNAME:" + icsEscape(nm)) + "\r\n";
    for (const auto& ev : f["events"]) {
        std::string id = ev.value("id", std::string());
        long long st = (ev.contains("startTime") && ev["startTime"].is_number()) ? ev["startTime"].get<long long>() : 0;
        long long en = (ev.contains("endTime") && ev["endTime"].is_number()) ? ev["endTime"].get<long long>() : st;
        bool allDay = ev.value("allDay", false);
        out += "BEGIN:VEVENT\r\n";
        out += icsFold("UID:" + (id.empty() ? std::to_string(st) : id) + "@scala") + "\r\n";
        out += "DTSTAMP:" + dtstamp + "\r\n";
        if (allDay) {
            out += "DTSTART;VALUE=DATE:" + icsFmtDate(st) + "\r\n";
            out += "DTEND;VALUE=DATE:" + icsFmtDate((en > st ? en : st) + 86400000LL) + "\r\n";   // DTEND is exclusive
        } else {
            out += "DTSTART:" + icsFmtUtc(st) + "\r\n";
            out += "DTEND:" + icsFmtUtc(en > 0 ? en : st) + "\r\n";
        }
        std::string title = ev.value("title", std::string());       if (!title.empty()) out += icsFold("SUMMARY:" + icsEscape(title)) + "\r\n";
        std::string desc  = ev.value("description", std::string()); if (!desc.empty())  out += icsFold("DESCRIPTION:" + icsEscape(desc)) + "\r\n";
        std::string loc   = ev.value("location", std::string());    if (!loc.empty())   out += icsFold("LOCATION:" + icsEscape(loc)) + "\r\n";
        std::string url   = ev.value("url", std::string());         if (!url.empty())   out += icsFold("URL:" + icsEscape(url)) + "\r\n";
        if (ev.contains("recur") && ev["recur"].is_object()) {
            const auto& r = ev["recur"]; std::string freq = r.value("freq", std::string());
            std::string F = freq == "daily" ? "DAILY" : freq == "weekly" ? "WEEKLY" : freq == "monthly" ? "MONTHLY" : freq == "yearly" ? "YEARLY" : "";
            if (!F.empty()) {
                std::string rr = "RRULE:FREQ=" + F;
                if (r.contains("interval") && r["interval"].is_number() && r["interval"].get<int>() > 1) rr += ";INTERVAL=" + std::to_string(r["interval"].get<int>());
                if (r.contains("until") && r["until"].is_number()) rr += ";UNTIL=" + icsFmtUtc(r["until"].get<long long>());
                out += rr + "\r\n";
            }
        }
        out += "END:VEVENT\r\n";
    }
    out += "END:VCALENDAR\r\n";
    return out;
}

std::string ScalaImpl::importIcs(const std::string& calendarId, const std::string& icsText) {
    if (m_store->calendar(calendarId).id.empty()) return json{{"imported", 0}, {"error", "unknown calendar"}}.dump();
    // Unfold: a line beginning with space/tab continues the previous one (RFC 5545 §3.1).
    std::vector<std::string> lines; { std::string cur, raw; std::stringstream ss(icsText);
        while (std::getline(ss, raw)) {
            if (!raw.empty() && raw.back() == '\r') raw.pop_back();
            if (!raw.empty() && (raw[0] == ' ' || raw[0] == '\t')) cur += raw.substr(1);
            else { if (!cur.empty()) lines.push_back(cur); cur = raw; }
        }
        if (!cur.empty()) lines.push_back(cur);
    }
    int imported = 0, skipped = 0; bool inEvent = false; json ev;
    for (const auto& line : lines) {
        if (line == "BEGIN:VEVENT") { inEvent = true; ev = json::object(); continue; }
        if (line == "END:VEVENT") {
            inEvent = false;
            if (ev.contains("startTime")) {
                if (!ev.contains("endTime"))
                    ev["endTime"] = ev.value("allDay", false) ? ev["startTime"].get<long long>() : ev["startTime"].get<long long>() + 3600000LL;
                // Idempotent import: reuse a stable event id from the VEVENT UID so re-importing (or
                // round-tripping our own export, which writes UID:<id>@scala) upserts by id instead of
                // duplicating. Foreign UIDs are used verbatim as the id (still a stable dedup key). No
                // UID → a fresh uuid (a one-off, can't dedup — matches the old behaviour).
                { std::string uid = ev.value("uid", std::string());
                  const std::string suf = "@scala";
                  if (uid.size() > suf.size() && uid.compare(uid.size() - suf.size(), suf.size(), suf) == 0)
                      uid = uid.substr(0, uid.size() - suf.size());
                  ev["id"] = uid.empty() ? generateUuid() : uid;
                  ev.erase("uid"); }
                authorAndPublish(scala::ET::EVENT_PUT, ev, calendarId);
                ++imported;
            } else ++skipped;
            continue;
        }
        if (!inEvent) continue;
        auto colon = line.find(':'); if (colon == std::string::npos) continue;
        std::string namepart = line.substr(0, colon), value = line.substr(colon + 1);
        auto semi = namepart.find(';');
        std::string name = (semi == std::string::npos) ? namepart : namepart.substr(0, semi);
        for (auto& ch : name) ch = toupper(ch);
        if      (name == "UID")         ev["uid"] = value;
        else if (name == "SUMMARY")     ev["title"] = icsUnescape(value);
        else if (name == "DESCRIPTION") ev["description"] = icsUnescape(value);
        else if (name == "LOCATION")    ev["location"] = icsUnescape(value);
        else if (name == "URL")         ev["url"] = icsUnescape(value);
        else if (name == "DTSTART")     { bool ad = false; long long ms = icsParseDate(value, ad); if (ms) { ev["startTime"] = ms; if (ad) ev["allDay"] = true; } }
        else if (name == "DTEND")       { bool ad = false; long long ms = icsParseDate(value, ad); if (ms) { if (ad) ms -= 86400000LL; ev["endTime"] = ms; } }
        else if (name == "RRULE") {
            json r = json::object(); std::stringstream rs(value); std::string kv;
            while (std::getline(rs, kv, ';')) {
                auto eq = kv.find('='); if (eq == std::string::npos) continue;
                std::string k = kv.substr(0, eq), val = kv.substr(eq + 1); for (auto& ch : k) ch = toupper(ch);
                if (k == "FREQ") { for (auto& ch : val) ch = tolower(ch); if (val == "daily" || val == "weekly" || val == "monthly" || val == "yearly") r["freq"] = val; }
                else if (k == "INTERVAL") { try { r["interval"] = std::stoi(val); } catch (...) {} }
                else if (k == "UNTIL") { bool ad = false; long long ms = icsParseDate(val, ad); if (ms) r["until"] = ms; }
            }
            if (r.contains("freq")) ev["recur"] = r;
        }
    }
    return json{{"imported", imported}, {"skipped", skipped}}.dump();
}

std::string ScalaImpl::exportCalendarIcsFile(const std::string& calendarId, const std::string& filePath) {
    std::string ics = exportCalendarIcs(calendarId);
    if (ics.empty()) return json{{"ok", false}, {"error", "unknown calendar"}}.dump();
    std::string path = filePath;
    if (path.size() < 4 || path.substr(path.size() - 4) != ".ics") path += ".ics";
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    if (!f) return json{{"ok", false}, {"error", "cannot write file"}}.dump();
    f.write(ics.data(), (std::streamsize)ics.size());
    if (!f) return json{{"ok", false}, {"error", "write failed"}}.dump();
    int n = 0; for (size_t pos = 0; (pos = ics.find("BEGIN:VEVENT", pos)) != std::string::npos; pos += 12) ++n;
    return json{{"ok", true}, {"path", path}, {"events", n}}.dump();
}

std::string ScalaImpl::importIcsFile(const std::string& calendarId, const std::string& filePath) {
    std::ifstream f(filePath, std::ios::binary);
    if (!f) return json{{"imported", 0}, {"error", "cannot read file"}}.dump();
    std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    return importIcs(calendarId, text);
}

// ── sharing ──────────────────────────────────────────────────────────────────
std::string ScalaImpl::shareCalendar(const std::string& calendarId) {
    return m_store->calendar(calendarId).key;
}
bool ScalaImpl::joinSharedCalendar(const std::string& calendarId, const std::string& encryptionKey) {
    m_store->upsertCalendar({ calendarId, encryptionKey, "", "" });
    m_sync->startSync(calendarId, encryptionKey);
    sendSyncReq(calendarId);   // just joined an existing calendar → pull its history
    return true;
}
std::string ScalaImpl::getSyncStatus(const std::string& calendarId) {
    if (m_store->calendar(calendarId).id.empty()) return "not_shared";
    return m_sync->isSyncing(calendarId) ? "syncing" : "offline";
}
std::string ScalaImpl::generateShareLink(const std::string& calendarId) {
    scala::CalReg c = m_store->calendar(calendarId);
    if (c.id.empty() || c.key.empty()) return "";
    json f = scala::foldCalendar(c.id, m_store->log(c.id));
    std::string nm = f.value("name", std::string()); if (nm.empty()) nm = c.name;
    return "scala://join?id=" + urlEncode(c.id) + "&key=" + b64urlEncode(c.key) + "&name=" + urlEncode(nm);
}
std::string ScalaImpl::parseShareLink(const std::string& link) {
    if (link.rfind("scala://join", 0) != 0) return "";
    auto q = parseQuery(link);
    std::string id = q["id"], key = b64urlDecode(q["key"]), name = q["name"];
    if (id.empty() || key.empty()) return "";
    return json{{"id", id}, {"key", key}, {"name", name}}.dump();
}
bool ScalaImpl::handleShareLink(const std::string& link, const std::string& identityId) {
    std::string parsed = parseShareLink(link);
    if (parsed.empty()) return false;
    json j = json::parse(parsed, nullptr, false);
    std::string id = j.value("id", std::string()), key = j.value("key", std::string()), name = j.value("name", std::string());
    if (id.empty() || key.empty()) return false;
    m_store->upsertCalendar({ id, key, name, "" });
    m_sync->startSync(id, key);
    // Bind the chosen identity (loam ADR 0004) so YOUR events on this calendar are authored by it.
    // (The owner is the inviter; this only sets who signs the joiner's writes.) None passed → the
    // current default, resolved at the core so a keycard default works even if the view sends nothing.
    std::string bindId = identityId;
    if (bindId.empty()) { try { json d = json::parse(modules().loam_core.getDefaultIdentityId(), nullptr, false);
        if (d.is_string()) bindId = d.get<std::string>(); } catch (...) {} }
    if (!bindId.empty()) { try { modules().loam_core.bindContainer(id, bindId); } catch (...) {} }
    sendSyncReq(id);   // just joined → pull history
    return true;
}

// ── settings ─────────────────────────────────────────────────────────────────
void ScalaImpl::setSetting(const std::string& key, const std::string& value) { m_store->kvSet("set:" + key, value); }
std::string ScalaImpl::getSetting(const std::string& key, const std::string& def) {
    std::string v = m_store->kvGet("set:" + key); return v.empty() ? def : v;
}

// ── QR (vendored qrcodegen → matrix; data: URIs are sandbox-blocked) ─────────
std::string ScalaImpl::qrMatrix(const std::string& text) {
    json out;
    if (text.empty()) { out["ok"] = false; out["error"] = "empty"; return out.dump(); }
    try {
        const qrcodegen::QrCode qr = qrcodegen::QrCode::encodeText(text.c_str(), qrcodegen::QrCode::Ecc::MEDIUM);
        const int n = qr.getSize();
        json cells = json::array();
        for (int y = 0; y < n; ++y) for (int x = 0; x < n; ++x) cells.push_back(qr.getModule(x, y) ? 1 : 0);
        out["ok"] = true; out["n"] = n; out["cells"] = std::move(cells);
    } catch (const std::exception& e) { out["ok"] = false; out["error"] = std::string("qr: ") + e.what(); }
    return out.dump();
}

// ── diagnostics ──────────────────────────────────────────────────────────────
std::string ScalaImpl::diagnostics() {
    ensureDelivery();
    json out;
    out["identity"] = m_identity;
    out["ctxReady"] = m_ctxReady;
    out["deliveryStatus"] = m_deliveryStatus;
    out["nodeReady"] = m_sync ? m_sync->ready() : false;
    out["dataDir"] = m_store ? m_store->dataDir() : std::string();
    json cals = json::array();
    int totalEvents = 0;
    for (const auto& c : m_store->calendars()) {
        json f = scala::foldCalendar(c.id, m_store->log(c.id));
        int n = (int)f["events"].size(); totalEvents += n;
        std::string nm = f.value("name", std::string()); if (nm.empty()) nm = c.name;
        cals.push_back(json{{"id", c.id}, {"name", nm}, {"shared", true},
                            {"syncing", m_sync ? m_sync->isSyncing(c.id) : false}, {"events", n}});
    }
    out["calendars"] = cals;
    out["calendarCount"] = (int)m_store->calendars().size();
    out["eventCount"] = totalEvents;
    return out.dump();
}

// unused legacy hook (kept to satisfy the header declaration).
void ScalaImpl::onSyncMessageReceived(const std::string&, const std::string&) {}

// ── Attachments via Logos Storage (ADR 0017) ─────────────────────────────────
namespace {
namespace afs = std::filesystem;
bool scalaReadFile(const std::string& path, std::string& out) {
    std::ifstream f(path, std::ios::binary); if (!f) return false;
    out.assign((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>()); return true;
}
bool scalaWriteFile(const std::string& path, const std::string& data) {
    std::ofstream f(path, std::ios::binary | std::ios::trunc); if (!f) return false;
    f.write(data.data(), (std::streamsize)data.size()); return (bool)f;
}
std::string scalaSha256Hex(const std::string& s) {
    scala::Bytes in(s.begin(), s.end());
    scala::Bytes h = scala::sha256b(in);
    return scala::toHexS(h.data(), (int)h.size());
}
std::string resVal(const StdLogosResult& r) {   // sessionId/string value out of a StdLogosResult
    return r.value.is_string() ? r.value.get<std::string>() : std::string();
}
} // namespace

std::string ScalaImpl::attachmentsDir() {
    std::string d = m_storageDir.empty() ? getSetting("storage_dir", std::string(getenv("HOME") ? getenv("HOME") : ".") + "/.scala-storage") : m_storageDir;
    std::error_code ec; afs::create_directories(d + "/files", ec);
    return d + "/files";
}

// Idempotent: subscribe to completion events, then init+start the storage node. Config is
// setting-driven: `storage_bootstrap` (our hub SPR — bootstrap off our own Kademlia network,
// NOT public logos.test), `storage_extip` (declare a reachable LAN/mesh IP so a hub advertises),
// `storage_dir` (persistent cache dir).
void ScalaImpl::ensureStorage() {
    if (m_storageInit) return;
    m_storageInit = true;
    m_storageDir = getSetting("storage_dir", std::string(getenv("HOME") ? getenv("HOME") : ".") + "/.scala-storage");
    std::error_code ec;
    afs::create_directories(m_storageDir + "/tmp", ec);
    afs::create_directories(m_storageDir + "/dl", ec);
    afs::create_directories(m_storageDir + "/files", ec);

    if (!m_storageCbReg) {   // register once — callbacks live on the module, survive a node restart
        modules().storage_module.onStorageUploadDone([this](const std::string& payload) { onStorageUploadDone(payload); });
        modules().storage_module.onStorageDownloadDone([this](const std::string& payload) { onStorageDownloadDone(payload); });
        m_storageCbReg = true;
    }

    json cfg;
    cfg["log-level"] = getSetting("storage_loglevel", "INFO");   // INFO so node startup + uploads are visible
    cfg["data-dir"] = m_storageDir + "/node";
    // a listen port for the node's libp2p endpoint (needed to start); overridable to avoid conflicts.
    try { cfg["listen-port"] = std::stoi(getSetting("storage_listen_port", "8199")); } catch (...) { cfg["listen-port"] = 8199; }
    // Default clients to OUR always-on VPS hub's private DHT (a public Storage provider on
    // 128.140.55.128:8199), so shared-calendar attachments resolve with no per-user config —
    // same SPR baked into mobile. Overridable via the storage_bootstrap setting. The hub itself
    // sets storage_root=1, which is checked FIRST below so it stays a no-bootstrap root.
    static const char* kDefaultHubSpr =
        "spr:CiUIAhIhAs8AX5JLuRffkJiqakPZmpE_WeRw_xFzpYfWF13jGgupEgIDARo7CicAJQgCEiECzwBfkku5F9-QmKpqQ9makT9Z5HD_EXOlh9YXXeMaC6kQiOWy1QYaCgoIBICMN4AGIAcqRzBFAiEApW6gyJWos3KuqcV6DfAYwnwddjGni2ryZqjI7ud6MtMCICqFNyyEC3YgjiYHN0Wr3XZRn0ESD8v00Sv6cWynXTvK";
    std::string boot = getSetting("storage_bootstrap", kDefaultHubSpr);
    std::string rootMode = getSetting("storage_root", "");
    bool isRoot = (rootMode == "1" || rootMode == "true");
    if (isRoot) cfg["no-bootstrap-node"] = true;                        // hub: the private-DHT root (needs extip) — FIRST
    else if (!boot.empty()) cfg["bootstrap-node"] = json::array({ boot }); // client: ride the hub's DHT (default = the hub)
    else cfg["network"] = "logos.test";                                 // (only if the default is explicitly cleared)
    std::string extip = getSetting("storage_extip", "");
    // Shrooms mesh mode is OPT-IN (setting `storage_mesh=1`), NOT auto — and only sound for a client
    // that shares the HUB's mesh SEGMENT. Auto-enabling it regressed the common case: a node listening
    // on `::` with an IPv6 extip on a DIFFERENT mesh prefix than the hub (e.g. Basecamp on fd3b:… vs
    // hub on fdb0:…) can't complete block exchange with the hub over its public IPv4 — the blockexc
    // stream opens then closes ("Stream Closed!") and the fetch stalls forever; it also advertises a
    // provider address unreachable to off-segment/off-mesh peers, stranding THEIR fetches. Default =
    // 0.0.0.0, which reliably fetches from the hub's public IP (the phone's proven path). Turn on
    // storage_mesh only when the node is on the same mesh segment as the hub (enables hub cache-on-see
    // to pull this node's uploads over the mesh). An explicit storage_extip always wins.
    std::string meshMode = getSetting("storage_mesh", "");
    std::string meshV6 = (meshMode == "1" || meshMode == "true") ? detectShroomsMeshIPv6() : std::string();
    if (!meshV6.empty() && !isRoot) {
        cfg["listen-ip"] = "::";
        if (extip.empty()) extip = meshV6;
        fprintf(stderr, "[scala] storage_mesh on: mesh IPv6 %s\n", meshV6.c_str());
    } else {
        cfg["listen-ip"] = "0.0.0.0";
    }
    if (!extip.empty()) cfg["nat"] = "extip:" + extip;
    try { modules().storage_module.init(cfg.dump()); modules().storage_module.start(); }
    catch (...) { /* best-effort; upload/fetch will retry the calls */ }
}

std::string ScalaImpl::uploadAttachment(const std::string& calendarId, const std::string& filePath,
                                        const std::string& name, const std::string& mime) {
    ensureStorage();
    std::string bytes;
    if (!scalaReadFile(filePath, bytes)) { finishUpload(calendarId, "", "{\"ok\":false,\"error\":\"cannot read file\"}"); return ""; }
    // Deterministic seal (nonce from plaintext hash) → same file → same sealed bytes → same CID.
    std::string sealId = scalaSha256Hex(bytes);
    std::string sealed = m_sync ? m_sync->sealBlob(calendarId, bytes, sealId) : std::string();
    if (sealed.empty()) { finishUpload(calendarId, "", "{\"ok\":false,\"error\":\"seal failed (unknown calendar key?)\"}"); return ""; }
    std::string blobId = scalaSha256Hex(sealed);
    std::string tmpPath = m_storageDir + "/tmp/" + blobId;
    if (!scalaWriteFile(tmpPath, sealed)) { finishUpload(calendarId, blobId, "{\"ok\":false,\"error\":\"cannot stage blob\"}"); return blobId; }
    StdLogosResult r = modules().storage_module.uploadUrl(tmpPath, 65536);
    if (!r.success) { json e{{"ok", false}, {"error", r.error.empty() ? "upload rejected" : r.error}}; finishUpload(calendarId, blobId, e.dump()); return blobId; }
    std::string sess = resVal(r);
    m_pendUp[sess] = PendingUp{ calendarId, name, mime, blobId, tmpPath, (long long)bytes.size() };
    return blobId;   // ref the view correlates on attachmentUploaded
}

// ── Snapshots (ADR 0020) ───────────────────────────────────────────────────────
// Cut the log at the latest completed epoch, serialize (canonical), AES-seal with the calendar key
// (CalendarSync::sealBlob — mobile opens it with the same scheme), and upload to Storage. The CID
// arrives async via onStorageUploadDone → getSnapshotPointer.
std::string ScalaImpl::snapshotCalendar(const std::string& calendarId, const std::string& epochSizeMsStr) {
    ensureStorageMesh();   // make our Codex mesh-dialable so the QR's SPR works for a phone over the overlay
    long long E = 3600000; // default epoch = 1h
    if (!epochSizeMsStr.empty()) { try { E = std::stoll(epochSizeMsStr); } catch (...) {} }
    if (E <= 0) E = 3600000;
    std::vector<scala::Event> log = m_store->log(calendarId);
    long long now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    long long boundary = logos_sync::snapshot::epochBoundary(now, E);
    std::vector<scala::Event> cut = logos_sync::snapshot::selectCut(log, boundary);
    if (cut.empty())
        return json{{"ok", false}, {"error", "empty cut (no events before the epoch boundary)"}, {"epoch", boundary}}.dump();
    std::string plaintext = logos_sync::snapshot::serializeSnapshot(cut, logos_sync::snapshot::boundaryHlc(boundary));
    std::string sealId = scalaSha256Hex(plaintext);                   // deterministic nonce → same cut → same bytes
    std::string sealed = m_sync ? m_sync->sealBlob(calendarId, plaintext, sealId) : std::string();
    if (sealed.empty())
        return json{{"ok", false}, {"error", "seal failed (unknown calendar key? is the calendar syncing?)"}}.dump();
    std::string tmpPath = m_storageDir + "/tmp/snap-" + scalaSha256Hex(sealed);
    if (!scalaWriteFile(tmpPath, sealed))
        return json{{"ok", false}, {"error", "cannot stage snapshot"}}.dump();
    StdLogosResult r = modules().storage_module.uploadUrl(tmpPath, 65536);
    if (!r.success)
        return json{{"ok", false}, {"error", r.error.empty() ? "upload rejected" : r.error}}.dump();
    std::string sess = resVal(r);
    m_pendSnap[sess] = PendingSnap{ calendarId, tmpPath, boundary, (long long)cut.size() };
    fprintf(stderr, "Scala: snapshot cal=%s epoch=%lld count=%zu → uploading (session %s)\n",
            calendarId.c_str(), boundary, cut.size(), sess.c_str());
    return json{{"ok", true}, {"status", "uploading"}, {"epoch", boundary}, {"count", (long long)cut.size()}}.dump();
}

std::string ScalaImpl::getSnapshotPointer(const std::string& calendarId) {
    auto it = m_lastSnapshot.find(calendarId);
    return it == m_lastSnapshot.end() ? std::string("{}") : it->second;
}
// (Re)start the storage node in shrooms-mesh mode so its Codex SPR announces a mesh-dialable address.
// Off the mesh (no mesh iface) it's a no-op. Persists storage_mesh=1 so future launches stay reachable.
void ScalaImpl::ensureStorageMesh() {
    std::string mesh = detectShroomsMeshIPv6();
    if (mesh.empty()) { ensureStorage(); return; }          // not on the mesh → best-effort default
    setSetting("storage_mesh", "1");
    if (m_storageInit && !m_storageMeshOn) {                 // already up in non-mesh mode → restart to re-announce
        fprintf(stderr, "[scala] restarting storage in mesh mode (extip %s)\n", mesh.c_str());
        try { modules().storage_module.stop(); } catch (...) {}
        m_storageInit = false;
    }
    ensureStorage();                                         // re-reads storage_mesh=1 → listen :: + extip=mesh IPv6
    m_storageMeshOn = true;
}
std::string ScalaImpl::getStorageSpr() {
    ensureStorage();
    try { StdLogosResult r = modules().storage_module.spr(); if (r.success) return resVal(r); } catch (...) {}
    return std::string();
}

void ScalaImpl::onStorageUploadDone(const std::string& payload) {
    json p = json::parse(payload, nullptr, false);
    if (p.is_discarded() || !p.is_object()) return;
    std::string sess = p.value("sessionId", std::string());
    // ADR 0020: a snapshot upload completing → record the pointer (getSnapshotPointer serves it).
    auto sit = m_pendSnap.find(sess);
    if (sit != m_pendSnap.end()) {
        PendingSnap sn = sit->second; m_pendSnap.erase(sit);
        std::error_code ec; afs::remove(sn.tmpPath, ec);
        if (p.value("success", false)) {
            std::string cid = p.value("cid", std::string());
            json ptr{{"v", 1}, {"cid", cid}, {"epoch", sn.epoch},
                     {"coversUpToHlc", {{"wall", sn.epoch}, {"ctr", 0}, {"dev", ""}}}, {"count", sn.count}};
            m_lastSnapshot[sn.calId] = ptr.dump();
            fprintf(stderr, "Scala: snapshot uploaded cal=%s cid=%s count=%lld\n", sn.calId.c_str(), cid.c_str(), sn.count);
        } else {
            fprintf(stderr, "Scala: snapshot upload FAILED cal=%s: %s\n", sn.calId.c_str(), p.value("error", std::string()).c_str());
        }
        return;
    }
    auto it = m_pendUp.find(sess);
    if (it == m_pendUp.end()) return;
    PendingUp up = it->second; m_pendUp.erase(it);
    std::error_code ec; afs::remove(up.tmpPath, ec);   // sealed blob now lives in the storage node
    if (!p.value("success", false)) {
        json e{{"ok", false}, {"error", p.value("error", std::string("upload failed"))}};
        finishUpload(up.calId, up.blobId, e.dump()); return;
    }
    json ok{{"ok", true}, {"cid", p.value("cid", std::string())}, {"name", up.name},
            {"mime", up.mime}, {"size", up.size}, {"blobId", up.blobId}};
    finishUpload(up.calId, up.blobId, ok.dump());
}

// Cache-on-see: for every attachment CID in a freshly-applied event we don't already hold, pull it
// into our local store. That makes THIS node a provider too — so a household/hub node caches and
// serves attachments for everyone, and content survives the original uploader going offline.
void ScalaImpl::cacheAttachments(const scala::Event& e) {
    if (e.type != scala::ET::EVENT_PUT) return;
    if (!e.payload.contains("attachments") || !e.payload["attachments"].is_array()) return;
    ensureStorage();
    for (const auto& a : e.payload["attachments"]) {
        if (!a.is_object()) continue;
        std::string cid = a.value("storageCid", std::string());
        if (cid.empty()) continue;
        try {
            StdLogosResult ex = modules().storage_module.exists(cid);
            bool have = ex.success && ((ex.value.is_boolean() && ex.value.get<bool>()) || (ex.value.is_string() && ex.value.get<std::string>() == "true"));
            if (!have) modules().storage_module.fetch(cid);   // async prefetch → we become a provider
        } catch (...) { /* best-effort caching */ }
    }
}

std::string ScalaImpl::downloadAttachment(const std::string& calendarId, const std::string& cid,
                                          const std::string& name) {
    ensureStorage();
    std::string sealedPath = m_storageDir + "/dl/" + cid + ".sealed";
    std::string outName = name.empty() ? cid : name;
    std::string outPath = attachmentsDir() + "/" + outName;
    StdLogosResult r = modules().storage_module.downloadToUrl(cid, sealedPath, false, 65536);
    if (!r.success) { json e{{"ok", false}, {"error", r.error.empty() ? "download rejected" : r.error}}; finishDownload(calendarId, cid, e.dump()); return cid; }
    std::string sess = resVal(r);
    m_pendDown[sess] = PendingDown{ calendarId, outName, cid, sealedPath, outPath };
    return cid;
}

void ScalaImpl::onStorageDownloadDone(const std::string& payload) {
    json p = json::parse(payload, nullptr, false);
    if (p.is_discarded() || !p.is_object()) return;
    std::string sess = p.value("sessionId", std::string());
    auto it = m_pendDown.find(sess);
    if (it == m_pendDown.end()) return;
    PendingDown dn = it->second; m_pendDown.erase(it);
    if (!p.value("success", false)) {
        json e{{"ok", false}, {"error", p.value("error", std::string("download failed"))}};
        finishDownload(dn.calId, dn.cid, e.dump()); return;
    }
    std::string sealed;
    if (!scalaReadFile(dn.sealedPath, sealed)) { finishDownload(dn.calId, dn.cid, "{\"ok\":false,\"error\":\"downloaded blob missing\"}"); return; }
    auto plain = m_sync ? m_sync->openBlob(dn.calId, sealed) : std::nullopt;
    std::error_code ec; afs::remove(dn.sealedPath, ec);
    if (!plain) { finishDownload(dn.calId, dn.cid, "{\"ok\":false,\"error\":\"decrypt failed (wrong key?)\"}"); return; }
    if (!scalaWriteFile(dn.outPath, *plain)) { finishDownload(dn.calId, dn.cid, "{\"ok\":false,\"error\":\"cannot write file\"}"); return; }
    json ok{{"ok", true}, {"path", dn.outPath}, {"name", dn.name}};
    finishDownload(dn.calId, dn.cid, ok.dump());
}

// Store the outcome for the poll-based view AND emit the async event (for any subscriber).
void ScalaImpl::finishUpload(const std::string& calId, const std::string& ref, const std::string& j) {
    if (!ref.empty()) m_attachResults[ref] = j;
    attachmentUploaded(calId, ref, j);
}
void ScalaImpl::finishDownload(const std::string& calId, const std::string& ref, const std::string& j) {
    if (!ref.empty()) m_attachResults[ref] = j;
    attachmentReady(calId, ref, j);
}
std::string ScalaImpl::attachmentStatus(const std::string& ref) {
    auto it = m_attachResults.find(ref);
    if (it == m_attachResults.end()) return "{\"pending\":true}";
    return it->second;
}
