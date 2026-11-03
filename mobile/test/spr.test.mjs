import { decodeSpr } from "../src/lib/spr.ts";
const v = [
 ["spr:CiUIAhIhAn67-cPFkDpqyeTEjDPbhtN8NUxt9S-niBc5QRLyc2xrEgIDARqNAQonACUIAhIhAn67-cPFkDpqyeTEjDPbhtN8NUxt9S-niBc5QRLyc2xrEKOs9NUGGgoKCASygIzOBh-GGlAKTgSygIzOBh-GgYDAAUECfrv5w8WQOmrJ5MSMM9uG03w1TG31L6eIFzlBEvJzbGt9p0eAmYeOFuGuZNjZLzrFoDPTCSAmcvOMSyNYACnJNSpHMEUCIQC4A-o40njBfVGDizRyvJvnGcoLEYSF-zuzSKuS2uqr0gIgIkgE0vaAguPk77hhMdgmwvXC5JKg-N32SMLG3LzhOaE", "16Uiu2HAm3xPbYz2zsq5XVGDCMqKhhNXZWyYV6WLVv3yzzUiRJWnW", "178.128.140.206"],
 ["spr:CiUIAhIhA_aTx0w5sTTjM1GEgYYDd1cbzpzGQZ8eiqL77znxAunKEgIDARqNAQonACUIAhIhA_aTx0w5sTTjM1GEgYYDd1cbzpzGQZ8eiqL77znxAunKEKyv9NUGGgoKCASB1N0sBh-GGlAKTgSB1N0sBh-GgYDAAUED9pPHTDmxNOMzUYSBhgN3VxvOnMZBnx6KovvvOfEC6cqi5dDdZUsf7kHiD_bbZms9EoFGL7XR1ys-atutA8wdAipGMEQCIGb_ogB2JKtidsk1MHKu_HyqwuV6XHHtvjgHAiAFtNb-AiASDK6Cz5qfZmzIM_IQJ8cqimqpMp7S-21nAstLqPq22w", "16Uiu2HAmVFXLh9fs5mExDDwzsah2rWdiHR2Fy3cPmF5xPx29vrbB", "129.212.221.44"],
];
let ok = true;
for (const [spr, id, ip] of v) { const r = decodeSpr(spr); console.log(JSON.stringify(r && { peerId: r.peerId, addrs: r.addrs })); if (!r || r.peerId !== id || !r.addrs.some(a => a.includes(ip))) ok = false; }
console.log(decodeSpr("spr:garbage!!"), decodeSpr("nope"));
console.log(ok ? "PASS" : "FAIL"); if (!ok) process.exit(1);
