#pragma once
// Share links, invite links and identity references (scala ADR 0022). Pure helpers (no Qt, no module
// calls) so test/links_test.cpp can exercise them directly.
//
//   join link     scala://join?id=<calId>&key=<b64url(key)>&name=<urlenc(name)>
//   invite link   <join link>&inv=<ticket private key, 64 hex>
//   identity ref  loam://id?pub=<66 hex compressed secp256k1 key>   (address computed from the key)
//                 or a plain address 0x + 40 hex
#include <cctype>
#include <cstdlib>
#include <map>
#include <sstream>
#include <string>
#include <vector>
#include "scala_identity.hpp"

namespace scala {
namespace links {

// base64url (RFC 4648, no padding) — matches the mobile invite key encoding.
inline const char* b64Alphabet() { return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; }
inline std::string b64urlEncode(const std::string& in) {
    const char* A = b64Alphabet();
    std::string out; int val = 0, bits = -6;
    for (unsigned char c : in) { val = (val << 8) + c; bits += 8;
        while (bits >= 0) { out.push_back(A[(val >> bits) & 0x3F]); bits -= 6; } }
    if (bits > -6) out.push_back(A[((val << 8) >> (bits + 8)) & 0x3F]);
    return out;
}
inline std::string b64urlDecode(const std::string& in) {
    const char* A = b64Alphabet();
    std::vector<int> T(256, -1); for (int i = 0; i < 64; i++) T[(unsigned char)A[i]] = i;
    std::string out; int val = 0, bits = -8;
    for (unsigned char c : in) { if (T[c] == -1) continue; val = (val << 6) + T[c]; bits += 6;
        if (bits >= 0) { out.push_back(char((val >> bits) & 0xFF)); bits -= 8; } }
    return out;
}
inline std::string urlEncode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF"; std::string o;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o.push_back((char)c);
        else { o.push_back('%'); o.push_back(hex[c >> 4]); o.push_back(hex[c & 15]); }
    }
    return o;
}
inline std::string urlDecode(const std::string& s) {
    std::string o;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '%' && i + 2 < s.size()) { o.push_back((char)std::strtol(s.substr(i + 1, 2).c_str(), nullptr, 16)); i += 2; }
        else if (s[i] == '+') o.push_back(' ');
        else o.push_back(s[i]);
    }
    return o;
}
inline std::map<std::string, std::string> parseQuery(const std::string& link) {
    std::map<std::string, std::string> q;
    auto pos = link.find('?'); if (pos == std::string::npos) return q;
    std::stringstream ss(link.substr(pos + 1)); std::string pair;
    while (std::getline(ss, pair, '&')) {
        auto eq = pair.find('=');
        if (eq == std::string::npos) continue;
        q[urlDecode(pair.substr(0, eq))] = urlDecode(pair.substr(eq + 1));
    }
    return q;
}
inline std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char)s[a])) a++;
    while (b > a && std::isspace((unsigned char)s[b - 1])) b--;
    return s.substr(a, b - a);
}
inline std::string lower(std::string s) { for (auto& c : s) c = (char)std::tolower((unsigned char)c); return s; }
inline bool isHex(const std::string& s, size_t n) {
    if (s.size() != n) return false;
    for (char c : s) if (!std::isxdigit((unsigned char)c)) return false;
    return true;
}

// A secp256k1 private key: 32 bytes, 0 < k < n. (OpenSSL's EC_KEY_set_private_key accepts k >= n and
// silently reduces it, so identityFromPriv alone is not a range check.)
inline bool validScalarHex(const std::string& hex) {
    static const unsigned char kN[32] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFE,
                                         0xBA,0xAE,0xDC,0xE6,0xAF,0x48,0xA0,0x3B,0xBF,0xD2,0x5E,0x8C,0xD0,0x36,0x41,0x41};
    if (!isHex(hex, 64)) return false;
    Bytes k = fromHexB(hex);
    if (k.size() != 32) return false;
    bool nonZero = false; for (unsigned char b : k) if (b) nonZero = true;
    return nonZero && std::lexicographical_compare(k.begin(), k.end(), kN, kN + 32);
}

struct JoinLink {
    bool ok = false;
    std::string id, key, name;
    std::string inv;         // ticket private key (64 lowercase hex) or ""
    std::string invError;    // set when an inv= was present but malformed (the join itself still works)
};
inline std::string buildJoinLink(const std::string& id, const std::string& key, const std::string& name) {
    return "scala://join?id=" + urlEncode(id) + "&key=" + b64urlEncode(key) + "&name=" + urlEncode(name);
}
inline std::string buildInviteLink(const std::string& joinLink, const std::string& ticketPrivHex) {
    return joinLink + "&inv=" + lower(ticketPrivHex);
}
inline JoinLink parseJoinLink(const std::string& raw) {
    JoinLink j;
    const std::string link = trim(raw);
    if (link.rfind("scala://join", 0) != 0) return j;
    auto q = parseQuery(link);
    j.id = q["id"]; j.key = b64urlDecode(q["key"]); j.name = q["name"];
    if (j.id.empty() || j.key.empty()) return j;
    j.ok = true;
    auto it = q.find("inv");
    if (it != q.end()) {
        const std::string inv = lower(trim(it->second));
        // A valid ticket is a secp256k1 scalar: 64 hex in [1, n-1].
        if (validScalarHex(inv) && identityFromPriv(fromHexB(inv)).valid) j.inv = inv;
        else j.invError = "the invite part of the link is damaged";
    }
    return j;
}

// Address of a compressed secp256k1 public key (66 hex), or "" if it isn't a point on the curve.
inline std::string addressFromPubHex(const std::string& pubHexIn) {
    const std::string pubHex = lower(pubHexIn);
    if (!isHex(pubHex, 66) || (pubHex.compare(0, 2, "02") != 0 && pubHex.compare(0, 2, "03") != 0)) return "";
    Bytes pub = fromHexB(pubHex);
    EC_KEY* key = EC_KEY_new_by_curve_name(NID_secp256k1);
    BN_CTX* ctx = BN_CTX_new();
    bool onCurve = false;
    if (key && ctx) {
        const EC_GROUP* grp = EC_KEY_get0_group(key);
        EC_POINT* pt = EC_POINT_new(grp);
        onCurve = pt && EC_POINT_oct2point(grp, pt, pub.data(), pub.size(), ctx) == 1 && EC_POINT_is_on_curve(grp, pt, ctx) == 1;
        EC_POINT_free(pt);
    }
    BN_CTX_free(ctx); EC_KEY_free(key);
    if (!onCurve) return "";
    Bytes h = sha256b(pub);
    return "0x" + toHexS(h.data(), 32).substr(24, 40);
}

struct IdentityRef { bool ok = false; std::string address, pubHex, error; };
// Accepts loam://id?pub=<66hex> (the address is COMPUTED from the key, so a typo can't grant a role
// to nobody: a mistyped key is almost never a curve point), a bare 66-hex key, or 0x + 40 hex.
inline IdentityRef parseIdentityRef(const std::string& raw) {
    IdentityRef r;
    const std::string s = trim(raw);
    if (s.empty()) { r.error = "paste an identity link or address"; return r; }
    std::string pub;
    if (s.rfind("loam://id", 0) == 0) {
        auto q = parseQuery(s);
        pub = trim(q["pub"]);
        if (pub.empty()) { r.error = "the identity link has no key (pub=)"; return r; }
    } else if (isHex(s, 66)) {
        pub = s;
    } else if (s.size() == 42 && (s.rfind("0x", 0) == 0 || s.rfind("0X", 0) == 0) && isHex(s.substr(2), 40)) {
        r.ok = true; r.address = "0x" + lower(s.substr(2)); return r;
    } else {
        r.error = "not an identity link (loam://id?pub=…) or address (0x + 40 hex)"; return r;
    }
    const std::string addr = addressFromPubHex(pub);
    if (addr.empty()) { r.error = "the identity key is not valid (check it was copied whole)"; return r; }
    r.ok = true; r.address = addr; r.pubHex = lower(pub);
    return r;
}

} // namespace links
} // namespace scala
