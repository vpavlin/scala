#pragma once
// snapshot.hpp — deterministic log snapshots (ADR 0020). Vendored from loam-sync, PURE half only:
// the epoch cut + canonical serialization. Scala seals the serialized bytes with its own AES-256-GCM
// blob seal (CalendarSync::sealBlob) and uploads via storage_module, so the loam-sync crypto helpers
// are intentionally omitted here. Canonical form matches loam-sync (cjson + eventToJson) and scala's
// mobile snapshot.ts, so a C++ writer and the mobile reader agree on the JSON a snapshot carries.
#include "event.hpp" // logos_sync::Event, HLC, compareHlc, eventToJson, eventFromJson, json
#include <string>
#include <vector>
#include <algorithm>
#include <stdexcept>

namespace logos_sync {
namespace snapshot {

// Canonical JSON: keys sorted recursively, no whitespace. Matches loam-sync `cjson` (TS + C++) and
// scala mobile's snapshot.ts cjson, so the serialized bytes are the same across writers.
inline std::string cjson(const json& v) {
    if (v.is_null()) return "null";
    if (v.is_boolean()) return v.get<bool>() ? "true" : "false";
    if (v.is_string()) { return json(v.get<std::string>()).dump(); }
    if (v.is_number_integer()) return std::to_string(v.get<long long>());
    if (v.is_number_unsigned()) return std::to_string(v.get<unsigned long long>());
    if (v.is_number_float()) {
        double d = v.get<double>(); long long ll = (long long)d;
        return ((double)ll == d) ? std::to_string(ll) : json(v).dump();
    }
    if (v.is_array()) {
        std::string o = "[";
        for (size_t i = 0; i < v.size(); i++) { if (i) o += ","; o += cjson(v[i]); }
        return o + "]";
    }
    if (v.is_object()) {
        std::vector<std::string> keys;
        for (auto it = v.begin(); it != v.end(); ++it) keys.push_back(it.key());
        std::sort(keys.begin(), keys.end());
        std::string o = "{";
        for (size_t i = 0; i < keys.size(); i++) { if (i) o += ","; o += json(keys[i]).dump() + ":" + cjson(v.at(keys[i])); }
        return o + "}";
    }
    return "null";
}

/** Latest boundary at or before nowMs. Writers target a COMPLETED (past) epoch so RBSR has converged
 *  and independent writers agree on the cut. Matches TS Math.floor(now/E)*E for positive now. */
inline long long epochBoundary(long long nowMs, long long epochSizeMs) {
    if (epochSizeMs <= 0) throw std::runtime_error("epochSizeMs must be > 0");
    return (nowMs / epochSizeMs) * epochSizeMs;
}

inline HLC boundaryHlc(long long boundaryMs) { return HLC{boundaryMs, 0, std::string()}; }

/** Events of a cut in canonical (HLC, id) order: those with HLC strictly before the boundary. */
inline std::vector<Event> selectCut(const std::vector<Event>& log, long long boundaryMs) {
    HLC bound = boundaryHlc(boundaryMs);
    std::vector<Event> out;
    for (const auto& e : log)
        if (!e.id.empty() && compareHlc(e.hlc, bound) < 0) out.push_back(e);
    std::sort(out.begin(), out.end(), [](const Event& a, const Event& b) {
        int c = compareHlc(a.hlc, b.hlc);
        return c != 0 ? c < 0 : a.id < b.id;
    });
    return out;
}

/** Canonical snapshot plaintext (seal these bytes, then upload). Matches loam-sync + scala mobile. */
inline std::string serializeSnapshot(const std::vector<Event>& events, const HLC& coversUpToHlc) {
    json arr = json::array();
    for (const auto& e : events) arr.push_back(eventToJson(e));
    json o{
        {"v", 1},
        {"coversUpToHlc", {{"wall", coversUpToHlc.wall}, {"ctr", coversUpToHlc.ctr}, {"dev", coversUpToHlc.dev}}},
        {"count", (long long)events.size()},
        {"events", arr},
    };
    return cjson(o);
}

} // namespace snapshot
} // namespace logos_sync
