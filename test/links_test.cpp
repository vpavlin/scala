// Unit test for scala_links.hpp (ADR 0022): join/invite link build + parse, identity-link validation.
// Run: test/links-test.sh
#include "scala_links.hpp"
#include <cstdio>

using namespace scala::links;
static int fails = 0, passes = 0;
static void check(bool c, const char* m) { std::printf("  %s  %s\n", c ? "ok  " : "FAIL", m); c ? ++passes : ++fails; }

int main() {
    // ── join links ────────────────────────────────────────────────────────────
    const std::string id = "3f2a9c1e-1111-4222-8333-444455556666";
    const std::string key = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" "ffffffff-0000-4111-8222-333333333333";
    const std::string join = buildJoinLink(id, key, "Family & friends");
    JoinLink j = parseJoinLink(join);
    check(j.ok && j.id == id && j.key == key && j.name == "Family & friends", "join link round-trips id, key and a name with spaces/&");
    check(j.inv.empty() && j.invError.empty(), "a plain join link carries no invite");
    check(parseJoinLink("  " + join + "\n").ok, "surrounding whitespace is ignored");
    check(!parseJoinLink("https://example.com/join?id=x&key=y").ok, "a non-scala link is rejected");
    check(!parseJoinLink("scala://join?id=" + id).ok, "a link without a key is rejected");

    // ── invite links ──────────────────────────────────────────────────────────
    const scala::SignId t = scala::generateIdentity();
    const std::string priv = scala::toHexS(t.priv.data(), 32);
    const std::string inv = buildInviteLink(join, priv);
    JoinLink ji = parseJoinLink(inv);
    check(ji.ok && ji.id == id && ji.key == key, "an invite link is still a valid join link");
    check(ji.inv == priv, "the ticket key round-trips");
    check(scala::identityFromPriv(scala::fromHexB(ji.inv)).address == t.address, "the ticket address derives from the link");
    std::string upper = priv; for (auto& c : upper) c = (char)std::toupper((unsigned char)c);
    check(parseJoinLink(join + "&inv=" + upper).inv == priv, "an upper-case ticket is normalised");
    JoinLink bad = parseJoinLink(join + "&inv=" + priv.substr(0, 63));
    check(bad.ok && bad.inv.empty() && !bad.invError.empty(), "a truncated ticket is flagged, the join itself still works");
    JoinLink zero = parseJoinLink(join + "&inv=" + std::string(64, '0'));
    check(zero.inv.empty() && !zero.invError.empty(), "a zero scalar is not a valid ticket");
    JoinLink overN = parseJoinLink(join + "&inv=" + std::string(64, 'f'));
    check(overN.inv.empty() && !overN.invError.empty(), "a scalar >= n is not a valid ticket");

    // ── identity references ───────────────────────────────────────────────────
    const scala::SignId p = scala::generateIdentity();
    IdentityRef r = parseIdentityRef("loam://id?pub=" + p.pubHex);
    check(r.ok && r.address == p.address && r.pubHex == p.pubHex, "loam://id?pub= → address computed from the key");
    std::string pubUp = p.pubHex; for (auto& c : pubUp) c = (char)std::toupper((unsigned char)c);
    check(parseIdentityRef("loam://id?pub=" + pubUp + "&label=Ann").address == p.address, "upper-case key + extra params accepted");
    check(parseIdentityRef(p.pubHex).address == p.address, "a bare 66-hex key is accepted");
    check(parseIdentityRef("  " + p.address + " ").address == p.address, "a plain 0x address is accepted (trimmed)");
    std::string addrUp = "0x" + p.address.substr(2); for (size_t i = 2; i < addrUp.size(); i++) addrUp[i] = (char)std::toupper((unsigned char)addrUp[i]);
    check(parseIdentityRef(addrUp).address == p.address, "a mixed-case address is lower-cased");
    check(!parseIdentityRef("loam://id?pub=" + p.pubHex.substr(0, 64)).ok, "a truncated key is rejected");
    std::string typo = "04" + p.pubHex.substr(2);   // 04 = the uncompressed marker, on 33 bytes
    check(!parseIdentityRef("loam://id?pub=" + typo).ok, "a key without an 02/03 prefix is rejected");
    // A typo in the x coordinate is, about half the time, not a curve point: find one that is not.
    int rejected = 0;
    for (int i = 2; i < 66 && rejected == 0; i++) {
        std::string k = p.pubHex; k[i] = k[i] == '0' ? '1' : '0';
        if (!parseIdentityRef("loam://id?pub=" + k).ok) rejected++;
    }
    check(rejected > 0, "a mistyped key that is off the curve is rejected (not granted to nobody)");
    check(!parseIdentityRef("loam://id").ok, "an identity link without pub= is rejected");
    check(!parseIdentityRef("0x1234").ok, "a short address is rejected");
    check(!parseIdentityRef("0x" + std::string(40, 'g')).ok, "a non-hex address is rejected");
    check(!parseIdentityRef("").ok, "empty input is rejected");
    check(!parseIdentityRef("bob").ok, "free text is rejected");

    std::printf("\n%s — %d passed, %d failed\n", fails ? "LINKS TEST FAILED" : "LINKS TEST OK", passes, fails);
    return fails ? 1 : 0;
}
