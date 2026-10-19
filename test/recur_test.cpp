// Unit test for src/scala_recur.hpp: dueOccurrences (shrooms ADR-064) — windows, recurrence rules,
// time zones and daylight-saving transitions. Run: test/recur-test.sh (the process runs in UTC).
#include "scala_recur.hpp"
#include <cstdio>
#include <string>

using nlohmann::json;
static int fails = 0, passes = 0;
#define CHECK(c, msg) do { if (c) ++passes; else { ++fails; std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, msg); } } while (0)

// ms for a UTC wall-clock
static long long utc(int y, int mo, int d, int h, int mi = 0) {
    std::tm t{}; t.tm_year = y - 1900; t.tm_mon = mo - 1; t.tm_mday = d; t.tm_hour = h; t.tm_min = mi;
    return (long long)timegm(&t) * 1000LL;
}
static json ev(const std::string& id, long long start, long long dur, json recur = nullptr) {
    json e = {{"id", id}, {"title", id}, {"startTime", start}, {"endTime", start + dur}};
    if (!recur.is_null()) e["recur"] = recur;
    return e;
}
static std::vector<long long> occs(const json& out, const std::string& id = "") {
    std::vector<long long> v;
    if (out.is_array()) for (auto& o : out) if (id.empty() || o["eventId"] == id) v.push_back(o["occ"].get<long long>());
    return v;
}

int main() {
    const long long H = 3600000LL;

    // 1. Daily 08:00 Europe/Prague across the end of summer time (Sun 2026-10-25 03:00 CEST -> 02:00 CET).
    //    08:00 CEST = 06:00 UTC; 08:00 CET = 07:00 UTC.
    {
        json evs = json::array({ev("daily", utc(2026, 10, 20, 6), 30 * 60000, {{"freq", "daily"}, {"interval", 1}})});
        json out = scala::dueOccurrences(evs, utc(2026, 10, 23, 0), utc(2026, 10, 28, 0), "Europe/Prague");
        auto v = occs(out);
        CHECK(v.size() == 5, "five days in the window");
        if (v.size() == 5) {
            CHECK(v[0] == utc(2026, 10, 23, 6), "Fri 23rd 08:00 CEST = 06:00 UTC");
            CHECK(v[1] == utc(2026, 10, 24, 6), "Sat 24th 08:00 CEST = 06:00 UTC");
            CHECK(v[2] == utc(2026, 10, 25, 7), "Sun 25th (change day) 08:00 CET = 07:00 UTC");
            CHECK(v[3] == utc(2026, 10, 26, 7), "Mon 26th 08:00 CET = 07:00 UTC");
            CHECK(v[4] == utc(2026, 10, 27, 7), "Tue 27th 08:00 CET = 07:00 UTC");
        }
        // The same event read in the process's own zone (UTC here) stays at 06:00 UTC: tz matters.
        auto u = occs(scala::dueOccurrences(evs, utc(2026, 10, 23, 0), utc(2026, 10, 28, 0), ""));
        CHECK(u.size() == 5 && u[4] == utc(2026, 10, 27, 6), "process zone (UTC) keeps 06:00 UTC");
    }
    // 2. Spring forward: Sun 2027-03-28 02:00 CET -> 03:00 CEST. 08:00 CET = 07:00 UTC; 08:00 CEST = 06:00 UTC.
    {
        json evs = json::array({ev("d", utc(2027, 3, 1, 7), 0, {{"freq", "daily"}})});
        auto v = occs(scala::dueOccurrences(evs, utc(2027, 3, 27, 0), utc(2027, 3, 30, 0), "Europe/Prague"));
        CHECK(v.size() == 3, "three days around spring forward");
        if (v.size() == 3) {
            CHECK(v[0] == utc(2027, 3, 27, 7), "Sat 27th 08:00 CET");
            CHECK(v[1] == utc(2027, 3, 28, 6), "Sun 28th 08:00 CEST");
            CHECK(v[2] == utc(2027, 3, 29, 6), "Mon 29th 08:00 CEST");
        }
    }
    // 3. An event inside the skipped hour (02:30 on spring-forward day) still fires once that day.
    {
        json evs = json::array({ev("gap", utc(2027, 3, 26, 1, 30), 0, {{"freq", "daily"}})});   // 02:30 CET
        auto v = occs(scala::dueOccurrences(evs, utc(2027, 3, 27, 12), utc(2027, 3, 29, 12), "Europe/Prague"));
        CHECK(v.size() == 2, "one occurrence on the change day and one after");
    }
    // 4. New York: daily 09:00 across 2026-11-01 (EDT -> EST). 09:00 EDT = 13:00 UTC; 09:00 EST = 14:00 UTC.
    {
        json evs = json::array({ev("ny", utc(2026, 10, 1, 13), 0, {{"freq", "daily"}})});
        auto v = occs(scala::dueOccurrences(evs, utc(2026, 10, 31, 0), utc(2026, 11, 2, 0), "America/New_York"));
        CHECK(v.size() == 2 && v[0] == utc(2026, 10, 31, 13) && v[1] == utc(2026, 11, 1, 14), "New York keeps 09:00 local");
    }
    // 5. Every other day (SPEL's routine): interval 2.
    {
        json evs = json::array({ev("spel", utc(2026, 10, 1, 6), 0, {{"freq", "daily"}, {"interval", 2}})});
        auto v = occs(scala::dueOccurrences(evs, utc(2026, 10, 10, 0), utc(2026, 10, 16, 0), "Europe/Prague"));
        CHECK(v.size() == 3 && v[0] == utc(2026, 10, 11, 6) && v[1] == utc(2026, 10, 13, 6) && v[2] == utc(2026, 10, 15, 6),
              "every other day: 11th, 13th, 15th");
    }
    // 6. Weekly, monthly, until.
    {
        json evs = json::array({
            ev("wk", utc(2026, 10, 5, 7), H, {{"freq", "weekly"}}),
            ev("mo", utc(2026, 1, 15, 7), H, {{"freq", "monthly"}}),
            ev("until", utc(2026, 10, 1, 7), H, {{"freq", "daily"}, {"until", utc(2026, 10, 3, 7)}}),
        });
        json out = scala::dueOccurrences(evs, utc(2026, 10, 1, 0), utc(2026, 11, 1, 0), "Europe/Prague");
        CHECK(occs(out, "wk").size() == 4, "weekly: 5, 12, 19, 26 Oct");
        CHECK(occs(out, "mo").size() == 1 && occs(out, "mo")[0] == utc(2026, 10, 15, 6), "monthly: 15 Oct, 08:00 local kept (CET in Jan, CEST in Oct)");
        CHECK(occs(out, "until").size() == 3, "until is inclusive: 1, 2, 3 Oct");
    }
    // 7. The window is [from, to): starts only. An event already running at `from` is not due again.
    {
        json evs = json::array({ev("one", utc(2026, 10, 19, 8), 2 * H), ev("edge", utc(2026, 10, 19, 12), 0)});
        auto v = occs(scala::dueOccurrences(evs, utc(2026, 10, 19, 9), utc(2026, 10, 19, 12), ""));
        CHECK(v.empty(), "running event and an event exactly at `to` are not due");
        auto w = occs(scala::dueOccurrences(evs, utc(2026, 10, 19, 12), utc(2026, 10, 19, 13), ""));
        CHECK(w.size() == 1 && w[0] == utc(2026, 10, 19, 12), "an event exactly at `from` is due");
    }
    // 8. Ordered by occ across events; malformed events skipped.
    {
        json evs = json::array({ev("late", utc(2026, 10, 19, 10), 0), ev("early", utc(2026, 10, 19, 9), 0),
                                json{{"title", "no id"}, {"startTime", utc(2026, 10, 19, 9)}},
                                json{{"id", "no start"}}, json{{"id", 5}, {"startTime", "x"}}, json("junk")});
        json out = scala::dueOccurrences(evs, utc(2026, 10, 19, 0), utc(2026, 10, 20, 0), "");
        CHECK(out.is_array() && out.size() == 2 && out[0]["eventId"] == "early" && out[1]["eventId"] == "late", "ordered, junk skipped");
    }
    // 9. Errors: unknown zone, path tricks, bad window. The process zone is put back after a named one.
    {
        json evs = json::array();
        CHECK(scala::dueOccurrences(evs, 0, 1, "Mars/Olympus").contains("error"), "unknown zone");
        CHECK(scala::dueOccurrences(evs, 0, 1, "../../etc/passwd").contains("error"), "path traversal refused");
        CHECK(scala::dueOccurrences(evs, 0, 1, "/usr/share/zoneinfo/UTC").contains("error"), "absolute path refused");
        CHECK(scala::dueOccurrences(evs, 5, 5, "").contains("error"), "empty window");
        const char* tz = std::getenv("TZ");
        CHECK(tz && std::string(tz) == "UTC", "TZ restored after a named zone");
    }

    std::printf("%d passed, %d failed\n", passes, fails);
    return fails ? 1 : 0;
}
