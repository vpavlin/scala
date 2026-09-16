// C++ side of the CATCH-UP parity/convergence test. Drives the ACTUAL desktop RBSR
// (../../src/logos_sync/catchup.hpp): prints the initial "fp" fingerprint frame for set A
// (must be byte-identical to the JS side — that's the cross-platform wire invariant), and
// runs a two-peer reconciliation to convergence. Compared against catchup_ts.mjs.
//   stdin  : {"a":[ids…],"b":[ids…]}
//   stdout : {"fp":"<fps>|<bounds>","a":"<sorted ids after>","b":"<sorted ids after>","rounds":N}
#include "../../src/logos_sync/catchup.hpp"
#include <iostream>
#include <sstream>
#include <algorithm>

using logos_sync::Event;
using logos_sync::json;
namespace cu = logos_sync::catchup;

static std::vector<Event> mk(const json& ids) {
  std::vector<Event> v;
  for (auto& i : ids) { Event e; e.id = i.get<std::string>(); v.push_back(e); }
  return v;
}
static bool hasId(const std::vector<Event>& v, const std::string& id) {
  for (auto& e : v) if (e.id == id) return true;
  return false;
}
static std::string sortedIdsStr(const std::vector<Event>& v) {
  std::vector<std::string> ids;
  for (auto& e : v) ids.push_back(e.id);
  std::sort(ids.begin(), ids.end());
  std::string s; for (auto& i : ids) { if (!s.empty()) s += ","; s += i; }
  return s;
}
// canonical fp-frame string: "<fps joined by ,>|<bounds joined by ,>"
static std::string fpStr(const json& frame) {
  std::string fps, bounds;
  for (auto& f : frame.value("fps", json::array())) { if (!fps.empty()) fps += ","; fps += f.get<std::string>(); }
  for (auto& b : frame.value("bounds", json::array())) { if (!bounds.empty()) bounds += ","; bounds += b.get<std::string>(); }
  return fps + "|" + bounds;
}

int main() {
  std::stringstream ss; ss << std::cin.rdbuf();
  json in = json::parse(ss.str());
  std::vector<Event> A = mk(in["a"]), B = mk(in["b"]);

  std::string fp = fpStr(cu::buildInitial(A, "A"));

  // two-peer reconciliation: a queue of {to, msg}; respond() serves the exact delta + replies.
  struct Q { std::string to; json msg; };
  std::vector<Q> q{{"B", cu::buildInitial(A, "A")}, {"A", cu::buildInitial(B, "B")}};
  int rounds = 0;
  while (!q.empty() && rounds < 100) {
    rounds++;
    std::vector<Q> next;
    for (auto& item : q) {
      bool toA = item.to == "A";
      std::vector<Event>& mine = toA ? A : B;
      std::vector<Event>& sender = toA ? B : A;   // serve + replies go back to the sender
      std::string me = item.to, dst = toA ? "B" : "A";
      cu::Step st = cu::respond(mine, item.msg, me);
      for (auto& e : st.serve) if (!hasId(sender, e.id)) sender.push_back(e);
      for (auto& r : st.replies) next.push_back({dst, r});
    }
    q = next;
  }

  json out{{"fp", fp}, {"a", sortedIdsStr(A)}, {"b", sortedIdsStr(B)}, {"rounds", rounds}};
  std::cout << out.dump() << std::endl;
  return 0;
}
