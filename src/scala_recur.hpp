#pragma once
// Recurrence expansion (series-based v1: freq daily|weekly|monthly|yearly, interval, until) —
// the same rule the QML view and mobile recur.ts use, by local calendar math, so "08:00 daily"
// stays 08:00 across a daylight-saving change. Header-only so a test can include it.
//
// dueOccurrences: which occurrences of a calendar's events START inside [fromMs, toMs), in a
// named time zone (IANA, e.g. "Europe/Prague") or the process's own ("") — for a scheduler that
// reads the calendar (shrooms ADR-064).

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <ctime>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

namespace scala {

constexpr long long kNoUntil = 4102444800000LL;   // ~year 2100, "no UNTIL" sentinel

// An event's occurrence start times (ms) overlapping [winStart, winEnd], in the process's zone.
inline std::vector<long long> expandOccurrences(const nlohmann::json& ev, long long winStart, long long winEnd) {
    std::vector<long long> occ;
    if (!ev.is_object() || !ev.contains("startTime") || !ev["startTime"].is_number()) return occ;
    long long start = ev["startTime"].get<long long>();
    long long end = (ev.contains("endTime") && ev["endTime"].is_number()) ? ev["endTime"].get<long long>() : start;
    long long dur = end > start ? end - start : 0;
    const nlohmann::json* r = (ev.contains("recur") && ev["recur"].is_object()) ? &ev["recur"] : nullptr;
    std::string freq = (r && r->contains("freq") && (*r)["freq"].is_string()) ? (*r)["freq"].get<std::string>() : std::string();
    if (freq.empty()) {
        if (start + dur >= winStart && start <= winEnd) occ.push_back(start);
        return occ;
    }
    int interval = 1;
    if (r->contains("interval") && (*r)["interval"].is_number()) { double iv = (*r)["interval"].get<double>(); interval = iv > 1 ? (int)iv : 1; }
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

// The tz database file for an IANA name, or "" (unknown name, or no tz database here).
inline std::string zoneFile(const std::string& name) {
    if (name.empty() || name.size() > 64 || name.front() == '/' || name.find("..") != std::string::npos) return "";
    for (char c : name)
        if (!(isalnum((unsigned char)c) || c == '/' || c == '_' || c == '-' || c == '+')) return "";
    std::vector<std::string> dirs;
    if (const char* d = std::getenv("TZDIR")) if (*d) dirs.push_back(d);
    for (const char* d : {"/usr/share/zoneinfo", "/usr/lib/zoneinfo", "/usr/share/lib/zoneinfo", "/etc/zoneinfo"}) dirs.push_back(d);
    for (const auto& d : dirs) {
        const std::string p = d + "/" + name;
        std::ifstream f(p, std::ios::binary);
        char magic[4] = {};
        if (f.read(magic, 4) && std::string(magic, 4) == "TZif") return p;
    }
    return "";
}

// Runs the local-time math in another zone while it lives: TZ set to the zone's file, put back after.
class ZoneScope {
public:
    explicit ZoneScope(const std::string& file) {
        const char* old = std::getenv("TZ");
        m_had = old != nullptr;
        if (old) m_old = old;
        setenv("TZ", (":" + file).c_str(), 1);
        tzset();
    }
    ~ZoneScope() {
        if (m_had) setenv("TZ", m_old.c_str(), 1); else unsetenv("TZ");
        tzset();
    }
    ZoneScope(const ZoneScope&) = delete;
    ZoneScope& operator=(const ZoneScope&) = delete;
private:
    bool m_had = false;
    std::string m_old;
};

// `events` = a FOLDED calendar's events. Returns [{eventId, occ}] for every occurrence starting in
// [fromMs, toMs), ordered by occ; or {"error": …} for an unknown time zone or a bad window.
inline nlohmann::json dueOccurrences(const nlohmann::json& events, long long fromMs, long long toMs, const std::string& tz) {
    if (toMs <= fromMs) return nlohmann::json{{"error", "toMs must be after fromMs"}};
    std::string file;
    if (!tz.empty()) {
        file = zoneFile(tz);
        if (file.empty()) return nlohmann::json{{"error", "Unknown time zone: " + tz}};
    }
    struct Due { long long occ; std::string id; };
    std::vector<Due> due;
    {
        std::unique_ptr<ZoneScope> zone;
        if (!file.empty()) zone = std::make_unique<ZoneScope>(file);
        if (events.is_array())
            for (const auto& ev : events) {
                if (!ev.is_object() || !ev.contains("id") || !ev["id"].is_string()) continue;
                for (long long o : expandOccurrences(ev, fromMs, toMs))
                    if (o >= fromMs && o < toMs) due.push_back({o, ev["id"].get<std::string>()});
            }
    }
    std::stable_sort(due.begin(), due.end(), [](const Due& a, const Due& b) { return a.occ < b.occ; });
    nlohmann::json out = nlohmann::json::array();
    for (const auto& d : due) out.push_back({{"eventId", d.id}, {"occ", d.occ}});
    return out;
}

} // namespace scala
