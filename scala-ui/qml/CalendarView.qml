// Scala calendar — pure-QML view over the `scala` core module.
//
// Rewritten from scratch to render correctly on the Logos design system that
// Basecamp bundles (Perun's view is the reference): only LogosText + LogosButton
// (the safe component baseline), Theme.palette.* / Theme.spacing.* tokens, and
// NUMERIC font.pixelSize (Theme.typography.<size> tokens don't exist on the
// bundled DS — that was the old view's invisible text). Inputs use plain
// TextField styled with tokens. Feature parity with the Android app: month grid,
// per-day events, event create/edit/delete, calendar create/join/share.
//
// The core is reached with a synchronous logos.callModule shim; returns come back
// DOUBLE-JSON-encoded, so `j()` unwraps up to twice.
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs

import Logos.Theme
import Logos.Controls

Item {
    id: root
    width: 900
    height: 640

    // ── core bridge ──────────────────────────────────────────────────────────
    property bool ready: false
    function core(method, args) {
        if (typeof logos === "undefined" || !logos.callModule) return ""
        var r = logos.callModule("scala", method, args || [])
        return (r === undefined || r === null) ? "" : (typeof r === "string" ? r : r)
    }
    // Core/view version guard: core + view are SEPARATE Basecamp packages, so a stale core can run
    // under a fresh view — silently signing with the wrong key while the view shows loam identities.
    // Detect it (old cores lack coreVersion() → "" → stale) and warn loudly instead of failing quietly.
    property bool coreOutOfDate: false
    property string coreVer: ""
    readonly property string minCore: "0.9.0"   // first core with loam-identity signing
    function verLt(a, b) {
        var pa = String(a).split("."), pb = String(b).split(".")
        for (var i = 0; i < 3; i++) { var x = parseInt(pa[i] || "0"), y = parseInt(pb[i] || "0"); if (x !== y) return x < y }
        return false
    }
    function checkCoreVersion() {
        root.coreVer = String(root.core("coreVersion", [])).replace(/^"|"$/g, "")
        root.coreOutOfDate = (root.coreVer === "" || root.verLt(root.coreVer, root.minCore))
    }
    function j(raw, fallback) {
        var v = raw
        for (var i = 0; i < 3 && typeof v === "string"; i++) {
            var t = v.trim()
            if (t === "") return fallback
            try { v = JSON.parse(t) } catch (e) { return (i === 0 ? fallback : v) }
        }
        return (v === undefined || v === null) ? fallback : v
    }
    // Identity SERVICE lives in loam_core (loam ADR 0004) — the panel talks to it directly.
    function loamCore(method, args) {
        if (typeof logos === "undefined" || !logos.callModule) return ""
        try { var r = logos.callModule("loam_core", method, args || []); return (r === undefined || r === null) ? "" : r } catch (e) { return "" }
    }

    // ── identities (loam_core service; UI is ours) ─────────────────────────────
    property var identities: []            // [{id,kind,label,address,pubHex}]
    property string defaultIdentityId: "device"
    property string renameTargetId: ""      // soft identity being renamed (idRenamePopup)
    property string idRemoveId: ""          // identity pending removal (idRemovePopup) + its meta for the warning
    property string idRemoveKind: ""
    property string idRemoveLabel: ""
    property string idRemoveAddr: ""
    // Defer the model assignment to the next event-loop tick. This is called from inside identity
    // Repeater delegates' onClicked (set-default / remove); assigning root.identities synchronously
    // there rebuilds that Repeater and destroys the very delegate whose handler is still on the stack
    // → "Object destroyed while a QML signal handler is in progress" → Aborted. Reads stay sync; only
    // the assign is deferred, so any caller (delegate or not) is crash-safe.
    function refreshIdentities() {
        var ids = root.j(loamCore("listIdentities", []), [])
        var def = root.j(loamCore("getDefaultIdentityId", []), "device")
        Qt.callLater(function () { root.identities = ids; root.defaultIdentityId = def })
    }
    function identityLabel(id) {
        for (var i = 0; i < identities.length; i++) if (identities[i].id === id) return identities[i].label
        return id
    }
    function calendarIdentityId(calId) {
        var m = root.j(loamCore("identityForContainer", [calId]), null)
        return m && m.id ? m.id : root.defaultIdentityId
    }
    // Identity meta (from the loaded list) whose address signs THIS calendar for me. calAddr[calId]
    // is the bound authoring address; falls back to the default identity when the calendar is unbound.
    function identityByAddr(addr) {
        if (!addr) return null
        for (var i = 0; i < identities.length; i++) if (identities[i].address === addr) return identities[i]
        return null
    }
    function calSigner(calId) { return identityByAddr(root.calAddr[calId] || "") }
    // True if authoring on this calendar goes through a Keycard (every write needs a card tap).
    function calIsKeycard(calId) { var m = calSigner(calId); return !!m && m.kind === "keycard" }
    // How many calendars this identity currently signs (by address) — drives the "removing this
    // orphans N calendars" warning, mirroring the fold's owner/binding resolution.
    function identitySignsCount(addr) {
        if (!addr) return 0
        var n = 0
        for (var i = 0; i < calendars.length; i++) if ((root.calAddr[calendars[i].id] || "") === addr) n++
        return n
    }

    // ── keycard authoring (scala ADR 0016) — poll the core snapshot; drive the overlay ─────────
    // A write on a keycard-owned calendar (or an enrol) signs asynchronously in loam via a card tap;
    // scala reports progress through keycardState(). We poll it fast and show a "hold your Keycard"
    // overlay while pending, an error on failure, and refresh on success.
    property var kc: ({ active: false })
    property string kcLastRef: ""
    function pollKeycard() {
        if (!root.ready) return
        var s = root.j(root.core("keycardState", []), { active: false })
        var prevPhase = root.kc.phase, prevRef = root.kc.ref
        root.kc = s
        // Reopen while pending — BUT not for a ref the user already cancelled (Cancel sets kcLastRef),
        // else closing the overlay just re-opens it on the next tick = an inescapable trap.
        if (s.phase === "pending" && s.ref !== root.kcLastRef) { if (!keycardOverlay.visible) keycardOverlay.open() }
        else if (s.ref && (s.ref !== root.kcLastRef)) {          // a terminal result we haven't shown yet
            root.kcLastRef = s.ref
            if (s.phase === "done") { keycardOverlay.close(); root.refresh() }
            // "failed" → keep the overlay open showing the error (user closes it)
        }
    }

    // ── state ────────────────────────────────────────────────────────────────
    property var calendars: []          // [{id,name,color,encryptionKey,...}]
    property var events: []             // flat list across all calendars
    property date viewMonth: new Date()   // any date in the shown month
    property date selectedDay: new Date()
    property string filterCalId: ""      // "" = all calendars (single-focus filter)
    property var hiddenCals: ({})        // per-device show/hide: {calId: true} = hidden from combined views
    function calHidden(id) { return !!root.hiddenCals[id] }
    function toggleCalVisible(id) {
        var h = {}; for (var k in root.hiddenCals) h[k] = root.hiddenCals[k]
        if (h[id]) delete h[id]; else h[id] = true
        root.hiddenCals = h   // reassign so bindings (monthOccurrences, day/week lists) re-evaluate
    }
    property string myIdentity: ""       // this device's identity (event author id)

    readonly property var fieldTypes: ["text","longtext","number","date","datetime","bool","url","enum","color"]

    readonly property var monthNames: ["January","February","March","April","May","June","July","August","September","October","November","December"]
    readonly property var weekDays: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

    // ── Catppuccin Mocha — match the mobile app's look (the bundled DS default is a flatter, colder
    // dark; the mobile app is warm Catppuccin). Local palette so the desktop canvas reads identically
    // to the phone. Used for the calendar surfaces/accents; DS components (inputs) keep their tokens.
    readonly property color cBase:    "#1e1e2e"   // app background
    readonly property color cMantle:  "#181825"   // side panels
    readonly property color cCrust:   "#11111b"   // deepest
    readonly property color cSurface: "#2a2a3c"   // cards / selected
    readonly property color cSurface2:"#313244"   // hover / borders
    readonly property color cOverlay: "#45475a"   // hairlines
    readonly property color cText:    "#cdd6f4"
    readonly property color cSub:     "#9399b2"
    readonly property color cFaint:   "#6c7086"   // out-of-month / tertiary
    readonly property color cBlue:    "#89b4fa"   // primary
    readonly property color cYellow:  "#f9e2af"   // today
    readonly property color cGreen:   "#a6e3a1"
    readonly property color cRed:     "#f38ba8"
    readonly property color cMauve:   "#cba6f7"

    Component.onCompleted: Qt.callLater(function () {
        root.ready = (typeof logos !== "undefined" && !!logos.callModule)
        if (root.ready) { root.checkCoreVersion(); root.myIdentity = String(root.j(root.core("getIdentity", []), "")); refresh() }
    })

    // Poll like kym's view does: listCalendars() self-drives the delivery bootstrap
    // in the core, so this keeps the node coming up + refreshes data. Also refreshes
    // the diagnostics while the Debug panel is open.
    // Slowed from 3s → 6s: refresh() makes several BLOCKING logos.callModule calls on the UI thread,
    // so a fast poll froze the view whenever scala/loam_core was busy (and a click during the freeze
    // piled another blocking call on). 6s halves that exposure; applies are also deferred (see refresh).
    Timer {
        interval: 6000; running: true; repeat: true
        onTriggered: {
            if (!root.ready) return
            root.refresh()
            root.computeSoon()
            if (diagPopup.visible) root.diag = root.j(root.core("diagnostics", []), null)
        }
    }

    // Keycard progress needs a snappier poll than the 3s data refresh (a card tap resolves in a few
    // seconds and the overlay must appear/clear promptly).
    Timer {
        interval: 700; running: root.ready; repeat: true
        onTriggered: root.pollKeycard()
    }

    // ── data ─────────────────────────────────────────────────────────────────
    function refresh() {
        if (!root.ready) return
        refreshIdentities()
        // RULE: no per-item blocking IPC in QML. The core aggregates everything the view needs into
        // two calls — listCalendars carries each calendar's authoring address (loam binding), and
        // listAllEvents returns every event tagged with calendarId — instead of 2·N blocking calls.
        var cals = j(core("listCalendars", []), [])
        var ca = {}
        for (var ci = 0; ci < cals.length; ci++) ca[cals[ci].id] = cals[ci].authorAddr || ""
        var evs = j(core("listAllEvents", []), [])
        // Deferred apply (same reason as refreshIdentities): reassigning these models rebuilds the
        // calendar/event Repeaters; deferring keeps that off any in-flight signal handler's stack.
        Qt.callLater(function () { root.calendars = cals; root.calAddr = ca; root.events = evs })
    }
    // Deterministic color derived from the calendar id — SAME on desktop + mobile,
    // so a calendar looks consistent across devices regardless of a stored color.
    readonly property var calPalette: ["#a6e3a1","#89b4fa","#f9e2af","#f38ba8","#cba6f7","#94e2d5","#fab387","#74c7ec","#eba0ac","#b4befe"]
    function calColor(calId) {
        if (!calId) return root.cBlue
        var h = 0
        for (var i = 0; i < calId.length; i++) h = (h * 31 + calId.charCodeAt(i)) >>> 0
        return root.calPalette[h % root.calPalette.length]
    }
    function calName(calId) {
        for (var i = 0; i < calendars.length; i++) if (calendars[i].id === calId) return calendars[i].name
        return ""
    }
    // My own RSVP (ADR 0021) on an event, for the at-a-glance card marker.
    function myRsvpOf(ev) { if (!ev || !ev.rsvps) return ""; var me = root.addrFor(root.calById(ev.calendarId)); return (me && ev.rsvps[me]) || "" }
    function rsvpMark(ev) { var s = root.myRsvpOf(ev); return s === "going" ? "✓ " : (s === "maybe" ? "? " : "") }
    // An event's colour IS its calendar's colour — the calendar is the event's identity here.
    // (A Frequencies-style app maps a custom-field value to colour itself; scala shows the field
    // value as a badge but keeps the event the calendar's colour — no per-event override.)
    function evColor(ev) { return root.calColor(ev ? ev.calendarId : "") }
    // Day timeline (calMode "day"): all-day band + hour-bucketed schedule for a day.
    function dayAllDay(d) { var a = root.eventsOnDay(d); var out = []; for (var i = 0; i < a.length; i++) if (a[i].allDay) out.push(a[i]); return out }
    function dayTimeline(d) {
        var a = root.eventsOnDay(d); var timed = []
        for (var i = 0; i < a.length; i++) if (!a[i].allDay) timed.push(a[i])
        timed.sort(function (x, y) { return x.startTime - y.startTime })
        var lo = 8, hi = 20
        for (var j = 0; j < timed.length; j++) {
            var s = new Date(timed[j].startTime).getHours()
            var e = new Date(timed[j].endTime); var eh = e.getHours() + (e.getMinutes() > 0 ? 1 : 0)
            lo = Math.min(lo, s); hi = Math.max(hi, Math.min(23, eh))
        }
        var rows = []
        for (var h = lo; h <= hi; h++) {
            var items = []
            for (var k = 0; k < timed.length; k++) if (new Date(timed[k].startTime).getHours() === h) items.push(timed[k])
            rows.push({ hour: h, items: items })
        }
        return rows
    }
    function hh(h) { return (h < 10 ? "0" + h : "" + h) + ":00" }
    function writableCalendars() {
        var out = []
        for (var i = 0; i < calendars.length; i++) if (calendars[i].encryptionKey || calendars[i].creatorId !== undefined) out.push(calendars[i])
        return out.length ? out : calendars
    }
    function calById(id) {
        for (var i = 0; i < calendars.length; i++) if (calendars[i].id === id) return calendars[i]
        return null
    }
    // Schema for a calendar, always an array (missing/empty → []).
    function schemaFor(calId) {
        var c = calById(calId)
        return (c && c.schema && c.schema.length) ? c.schema : []
    }
    // Short, human-friendly form of an identity string for history/roles lines.
    function shortAuthor(a) {
        if (!a) return "?"
        var s = String(a)
        if (s.indexOf("scala-") === 0) s = s.substring(6)
        return s.substring(0, 6)
    }
    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    }
    // Events filtered by the active calendar filter (null-safe on old events).
    function eventsFiltered() {
        var out = []
        for (var i = 0; i < events.length; i++) {
            var e = events[i]
            if (filterCalId !== "" && e.calendarId !== filterCalId) continue  // single-focus filter
            if (root.hiddenCals[e.calendarId]) continue                        // hidden calendars
            out.push(e)
        }
        return out
    }
    // Look up a master event by id (recurrence edits operate on the master).
    function eventById(id) {
        for (var i = 0; i < events.length; i++) if (events[i].id === id) return events[i]
        return null
    }

    // ── recurrence expansion (identical algorithm to the mobile app) ───────────
    function expandEvent(ev, winStart, winEnd) {
        var dur = Math.max(0, (ev.endTime || ev.startTime) - ev.startTime);
        var r = ev.recur;
        function mk(s){ var o={}; for (var k in ev) o[k]=ev[k]; o.startTime=s; o.endTime=s+dur; o.seriesId=ev.id; o.occ=s; return o; }
        if (!r || !r.freq) return (ev.startTime+dur>=winStart && ev.startTime<=winEnd) ? [mk(ev.startTime)] : [];
        var interval = Math.max(1, Math.floor(r.interval||1));
        var hardUntil = (typeof r.until === "number") ? r.until : Infinity;
        var out=[]; var cur=new Date(ev.startTime);
        for (var i=0;i<500;i++){
            var s=cur.getTime();
            if (s>hardUntil || s>winEnd) break;
            if (s+dur>=winStart) out.push(mk(s));
            if (r.freq==="daily") cur.setDate(cur.getDate()+interval);
            else if (r.freq==="weekly") cur.setDate(cur.getDate()+7*interval);
            else if (r.freq==="monthly") cur.setMonth(cur.getMonth()+interval);
            else if (r.freq==="yearly") cur.setFullYear(cur.getFullYear()+interval);
            else break;
        }
        return out;
    }
    function expandEvents(events, winStart, winEnd) {
        var out=[]; for (var i=0;i<events.length;i++){ var xs=expandEvent(events[i], winStart, winEnd); for (var k=0;k<xs.length;k++) out.push(xs[k]); }
        out.sort(function(a,b){return a.startTime-b.startTime;}); return out;
    }
    function recurLabel(r){ if(!r||!r.freq) return "Does not repeat"; var n=Math.max(1,Math.floor(r.interval||1)); var u={daily:"day",weekly:"week",monthly:"month",yearly:"year"}[r.freq]; var b=(n===1?("Every "+u):("Every "+n+" "+u+"s")); return r.until?(b+", until "+new Date(r.until).toLocaleDateString()):b; }

    // Cached expansion covering the whole visible 6×7 grid; re-evaluates when the
    // month, event set, or calendar filter changes.
    property var monthOccurrences: root.computeMonthOccurrences(root.viewMonth, root.events, root.filterCalId, root.hiddenCals)
    function computeMonthOccurrences(vm, evs, fcal, hidden) {
        var first = new Date(vm.getFullYear(), vm.getMonth(), 1)
        var offset = (first.getDay() + 6) % 7
        var firstCell = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
        var ws = new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate(), 0, 0, 0, 0).getTime()
        var we = ws + 42 * 24 * 3600 * 1000 - 1
        var src = []
        for (var i = 0; i < evs.length; i++) {
            if (fcal !== "" && evs[i].calendarId !== fcal) continue
            if (hidden[evs[i].calendarId]) continue
            src.push(evs[i])
        }
        return root.expandEvents(src, ws, we)
    }

    function eventsOnDay(d) {
        var ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
        var de = ds + 24 * 3600 * 1000 - 1
        var occ = expandEvents(eventsFiltered(), ds, de)
        var out = []
        for (var i = 0; i < occ.length; i++) if (sameDay(new Date(occ[i].startTime), d)) out.push(occ[i])
        return out
    }
    function dotsOnDay(d) {
        var cols = []
        var occ = root.monthOccurrences
        for (var i = 0; i < occ.length && cols.length < 4; i++)
            if (sameDay(new Date(occ[i].startTime), d)) cols.push(evColor(occ[i]))
        return cols
    }
    function fmtTime(ms) { return Qt.formatTime(new Date(ms), "hh:mm") }
    // Custom-field values as badges (status/type/tags) — skip empty + long, cap at 4.
    function fieldValues(ev) {
        var out = []
        if (ev && ev.fields) for (var k in ev.fields) { var v = String(ev.fields[k]); if (v.length > 0 && v.length <= 24) out.push(v) }
        return out.slice(0, 4)
    }
    // ── search (#) — match events across ALL dates by title/location/notes/calendar/fields ──
    property string searchQuery: ""
    function eventsMatching(q) {
        q = (q || "").trim().toLowerCase()
        if (q === "") return []
        var src = eventsFiltered(); var out = []
        for (var i = 0; i < src.length; i++) {
            var ev = src[i]
            var hay = ((ev.title || "") + " " + (ev.location || "") + " " + (ev.description || "") + " " + calName(ev.calendarId)).toLowerCase()
            if (ev.fields) for (var k in ev.fields) hay += " " + String(ev.fields[k]).toLowerCase()
            if (hay.indexOf(q) >= 0) out.push(ev)
        }
        out.sort(function (a, b) { return a.startTime - b.startTime })
        return out
    }
    readonly property bool searching: root.searchQuery.trim() !== ""
    readonly property var searchResults: root.searching ? root.eventsMatching(root.searchQuery) : []
    // ── month / week view ────────────────────────────────────────────────────
    property string calMode: "month"   // "month" | "week"
    function weekDaysOf(d) {
        var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))
        var out = []
        for (var i = 0; i < 7; i++) out.push(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i))
        return out
    }
    function weekLabel(d) {
        var w = weekDaysOf(d); var a = w[0]; var b = w[6]
        var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        if (a.getMonth() === b.getMonth()) return a.getDate() + " – " + b.getDate() + " " + mo[a.getMonth()] + " " + a.getFullYear()
        return a.getDate() + " " + mo[a.getMonth()] + " – " + b.getDate() + " " + mo[b.getMonth()] + " " + b.getFullYear()
    }
    function goPrev() {
        if (calMode === "week") { var d = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() - 7); selectedDay = d; viewMonth = d }
        else if (calMode === "day") { var dd = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() - 1); selectedDay = dd; viewMonth = dd }
        else viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
    }
    function goNext() {
        if (calMode === "week") { var d = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() + 7); selectedDay = d; viewMonth = d }
        else if (calMode === "day") { var dd = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() + 1); selectedDay = dd; viewMonth = dd }
        else viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)
    }
    function pad(n) { return (n < 10 ? "0" : "") + n }
    function fmtDateInput(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }
    function fmtTimeInput(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()) }
    function parseDateTime(dateStr, timeStr) {
        var dp = dateStr.split("-"), tp = timeStr.split(":")
        var d = new Date()
        if (dp.length === 3) d = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]))
        d.setHours(tp.length >= 1 ? parseInt(tp[0]) || 0 : 0, tp.length >= 2 ? parseInt(tp[1]) || 0 : 0, 0, 0)
        return d
    }

    // ── layout ───────────────────────────────────────────────────────────────
    Rectangle { anchors.fill: parent; color: root.cBase }

    // Stale-core warning: core + view are separate Basecamp packages, so a fresh view can run over an
    // old core that signs with the wrong identity. Warn loudly at the top rather than fail silently.
    Rectangle {
        id: staleCoreBanner
        visible: root.coreOutOfDate
        anchors { top: parent.top; left: parent.left; right: parent.right }
        height: visible ? bannerCol.implicitHeight + 18 : 0
        z: 9999
        color: "#f38ba8"
        ColumnLayout {
            id: bannerCol
            anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter; leftMargin: 16; rightMargin: 16 }
            spacing: 1
            LogosText {
                text: "⚠  Scala core is out of date" + (root.coreVer ? " (v" + root.coreVer + ")" : "")
                color: "#11111b"; font.pixelSize: 14; font.weight: Theme.typography.weightMedium
            }
            LogosText {
                Layout.fillWidth: true; wrapMode: Text.WordWrap
                text: "Update the ‘scala’ package to " + root.minCore + "+ in Basecamp — until then, events may be signed with the wrong identity."
                color: "#11111b"; font.pixelSize: 12
            }
        }
    }

    // ── "starting soon" banner (in-app substitute for desktop notifications) ──
    property var soonOcc: null          // the imminent occurrence, or null
    property string soonText: ""        // "<title> starts in <N> min"
    property bool soonVisible: false
    property real dismissedOcc: -1      // occ timestamp the user dismissed
    function computeSoon() {
        var now = Date.now()
        var occ = root.expandEvents(root.events, now, now + 15 * 60000)
        var best = null
        for (var i = 0; i < occ.length; i++) { if (occ[i].startTime >= now) { best = occ[i]; break } }
        if (best && best.occ !== root.dismissedOcc) {
            var mins = Math.max(0, Math.round((best.startTime - now) / 60000))
            root.soonText = (best.title || "(untitled)") + " starts in " + mins + " min"
            root.soonOcc = best
            root.soonVisible = true
        } else {
            root.soonOcc = best
            root.soonVisible = false
        }
    }

    Rectangle {
        id: soonBanner
        anchors.top: parent.top; anchors.left: parent.left; anchors.right: parent.right
        height: (root.soonVisible && root.soonText.length > 0) ? 40 : 0
        visible: height > 0
        clip: true
        color: root.cBlue
        RowLayout {
            anchors.fill: parent
            anchors.leftMargin: Theme.spacing.medium; anchors.rightMargin: Theme.spacing.small
            spacing: Theme.spacing.small
            Rectangle { width: 8; height: 8; radius: 4; color: root.cBase; Layout.alignment: Qt.AlignVCenter }
            LogosText {
                text: root.soonText; color: root.cBase
                font.pixelSize: 13; font.weight: Theme.typography.weightMedium
                Layout.fillWidth: true; elide: Text.ElideRight; Layout.alignment: Qt.AlignVCenter
            }
            LogosText {
                text: "✕"; color: root.cBase; font.pixelSize: 14; Layout.alignment: Qt.AlignVCenter
                MouseArea {
                    anchors.fill: parent; anchors.margins: -6
                    onClicked: {
                        if (root.soonOcc) root.dismissedOcc = root.soonOcc.occ
                        root.soonVisible = false
                    }
                }
            }
        }
    }

    // 3 resizable panes: calendars | month | agenda. Drag the dividers to resize.
    SplitView {
        anchors.top: soonBanner.bottom; anchors.left: parent.left
        anchors.right: parent.right; anchors.bottom: parent.bottom
        orientation: Qt.Horizontal

        // ── pane 1: calendars sidebar ──────────────────────────────────────
        Rectangle {
            SplitView.preferredWidth: 240
            SplitView.minimumWidth: 170
            color: root.cMantle
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spacing.medium
                spacing: Theme.spacing.small

                LogosText { text: "Calendars"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }

                Rectangle {
                    Layout.fillWidth: true; height: 36; radius: 9
                    color: root.filterCalId === "" ? root.cSurface : (allCalMA.containsMouse ? root.cBase : "transparent")
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                        Rectangle { width: 10; height: 10; radius: 5; color: root.cFaint }
                        LogosText { text: "All calendars"; color: root.cText; font.pixelSize: 14; Layout.fillWidth: true; elide: Text.ElideRight }
                    }
                    MouseArea { id: allCalMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.filterCalId = "" }
                }

                ListView {
                    Layout.fillWidth: true; Layout.fillHeight: true; clip: true
                    model: root.calendars
                    spacing: 2
                    delegate: Rectangle {
                        id: calRow
                        width: ListView.view.width
                        height: (modelData.description && modelData.description.length > 0) ? 50 : 36
                        radius: 9
                        color: root.filterCalId === modelData.id ? root.cSurface : (calRowMA.containsMouse ? root.cBase : "transparent")
                        RowLayout {
                            anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                            // Tap the dot to show/hide this calendar in the combined views (local only).
                            Rectangle {
                                width: 14; height: 14; radius: 7; Layout.alignment: Qt.AlignVCenter
                                color: root.calHidden(modelData.id) ? "transparent" : root.calColor(modelData.id)
                                border.width: root.calHidden(modelData.id) ? 2 : 0; border.color: root.cSub
                                MouseArea { anchors.fill: parent; anchors.margins: -3; cursorShape: Qt.PointingHandCursor
                                    onClicked: root.toggleCalVisible(modelData.id) }
                            }
                            ColumnLayout {
                                Layout.fillWidth: true; Layout.alignment: Qt.AlignVCenter; spacing: 1
                                RowLayout {
                                    Layout.fillWidth: true; spacing: 4
                                    LogosText { text: modelData.name || "(unnamed)"; color: root.calHidden(modelData.id) ? root.cSub : root.cText; font.pixelSize: 14; Layout.fillWidth: true; elide: Text.ElideRight }
                                    // 🔑 = this calendar is signed with a Keycard, so every edit needs a card tap.
                                    LogosText { visible: root.calIsKeycard(modelData.id); text: "🔑"; font.pixelSize: 12; Layout.alignment: Qt.AlignVCenter }
                                }
                                LogosText {
                                    visible: !!modelData.description && modelData.description.length > 0
                                    text: modelData.description || ""
                                    color: root.cFaint; font.pixelSize: 11; Layout.fillWidth: true; elide: Text.ElideRight
                                }
                            }
                            LogosText {
                                text: "⚙"; color: root.cSub; font.pixelSize: 14; Layout.alignment: Qt.AlignVCenter
                                MouseArea { anchors.fill: parent; anchors.margins: -4; cursorShape: Qt.PointingHandCursor; onClicked: root.openCalSettings(modelData) }
                            }
                            LogosText {
                                text: "share"; color: root.cBlue; font.pixelSize: 12; Layout.alignment: Qt.AlignVCenter
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.openShare(modelData) }
                            }
                            LogosText {
                                text: "✕"; color: root.cFaint; font.pixelSize: 14; Layout.alignment: Qt.AlignVCenter
                                MouseArea {
                                    anchors.fill: parent; anchors.margins: -4; cursorShape: Qt.PointingHandCursor
                                    onClicked: root.confirmDeleteCalendar(modelData)
                                }
                            }
                        }
                        MouseArea { id: calRowMA; anchors.fill: parent; z: -1; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.filterCalId = modelData.id }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true; implicitHeight: 40; radius: 9
                    color: newCalMA.containsMouse ? root.cSurface2 : root.cSurface
                    LogosText { anchors.centerIn: parent; text: "+ New calendar"; color: root.cText; font.pixelSize: 14; font.weight: Theme.typography.weightMedium }
                    MouseArea { id: newCalMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: newCalPopup.open() }
                }
                Rectangle {
                    Layout.fillWidth: true; implicitHeight: 40; radius: 9
                    color: joinMA.containsMouse ? root.cSurface : "transparent"
                    border.width: 1; border.color: root.cSurface2
                    LogosText { anchors.centerIn: parent; text: "Join calendar"; color: root.cText; font.pixelSize: 14 }
                    MouseArea { id: joinMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: joinPopup.open() }
                }
                Rectangle {
                    Layout.fillWidth: true; implicitHeight: 40; radius: 9
                    color: idsMA.containsMouse ? root.cSurface : "transparent"
                    border.width: 1; border.color: root.cSurface2
                    LogosText { anchors.centerIn: parent; text: "👤 Identities"; color: root.cText; font.pixelSize: 14 }
                    MouseArea { id: idsMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: { root.refreshIdentities(); identitiesPopup.open() } }
                }
            }
        }

        // ── pane 2: month ──────────────────────────────────────────────────
        Rectangle {
            SplitView.fillWidth: true
            SplitView.minimumWidth: 380
            color: root.cBase
            ColumnLayout {
            anchors.fill: parent
            spacing: 0

            RowLayout {
                Layout.fillWidth: true
                Layout.margins: Theme.spacing.medium
                spacing: Theme.spacing.small
                Rectangle {
                    implicitWidth: 34; implicitHeight: 34; radius: 9
                    color: navPrev.containsMouse ? root.cSurface2 : root.cSurface
                    LogosText { anchors.centerIn: parent; text: "‹"; color: root.cText; font.pixelSize: 18 }
                    MouseArea { id: navPrev; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: root.goPrev() }
                }
                Rectangle {
                    implicitWidth: 34; implicitHeight: 34; radius: 9
                    color: navNext.containsMouse ? root.cSurface2 : root.cSurface
                    LogosText { anchors.centerIn: parent; text: "›"; color: root.cText; font.pixelSize: 18 }
                    MouseArea { id: navNext; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: root.goNext() }
                }
                LogosText {
                    text: root.calMode === "week" ? root.weekLabel(root.selectedDay)
                        : root.calMode === "day" ? Qt.formatDate(root.selectedDay, "dddd, MMMM d")
                        : root.monthNames[root.viewMonth.getMonth()] + " " + root.viewMonth.getFullYear()
                    color: root.cText; font.pixelSize: 20; font.weight: Theme.typography.weightMedium
                    Layout.leftMargin: 4
                }
                // Month / Week segmented toggle
                Rectangle {
                    implicitWidth: modeRow.implicitWidth + 6; implicitHeight: 30; radius: 8
                    color: root.cSurface; Layout.leftMargin: 6
                    Row {
                        id: modeRow; anchors.centerIn: parent; spacing: 2
                        Repeater {
                            model: [{ m: "month", t: "Month" }, { m: "week", t: "Week" }, { m: "day", t: "Day" }]
                            Rectangle {
                                width: segT.implicitWidth + 18; height: 26; radius: 7
                                color: root.calMode === modelData.m ? root.cBlue : "transparent"
                                LogosText { id: segT; anchors.centerIn: parent; text: modelData.t
                                    color: root.calMode === modelData.m ? root.cCrust : root.cSub; font.pixelSize: 12 }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.calMode = modelData.m }
                            }
                        }
                    }
                }
                Rectangle {
                    implicitWidth: todayT.implicitWidth + 26; implicitHeight: 30; radius: 15
                    color: todayMA.containsMouse ? root.cSurface : "transparent"
                    border.width: 1; border.color: root.cSurface2
                    Layout.leftMargin: 4
                    LogosText { id: todayT; anchors.centerIn: parent; text: "Today"; color: root.cSub; font.pixelSize: 13 }
                    MouseArea { id: todayMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                        onClicked: { var n = new Date(); root.viewMonth = n; root.selectedDay = n } }
                }
                Item { Layout.fillWidth: true }
                Rectangle {
                    implicitWidth: dbgT.implicitWidth + 22; implicitHeight: 30; radius: 8
                    color: dbgMA.containsMouse ? root.cSurface : "transparent"
                    LogosText { id: dbgT; anchors.centerIn: parent; text: "Debug"; color: root.cFaint; font.pixelSize: 12 }
                    MouseArea { id: dbgMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.openDiag() }
                }
                Rectangle {
                    implicitWidth: addT.implicitWidth + 30; implicitHeight: 34; radius: 9
                    color: addMA.containsMouse ? Qt.darker(root.cBlue, 1.12) : root.cBlue
                    LogosText { id: addT; anchors.centerIn: parent; text: "+ Event"; color: root.cCrust; font.pixelSize: 13; font.weight: Theme.typography.weightMedium }
                    MouseArea { id: addMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.openNewEvent() }
                }
            }

            RowLayout {
                visible: root.calMode === "month"
                Layout.fillWidth: true; Layout.leftMargin: Theme.spacing.medium; Layout.rightMargin: Theme.spacing.medium; spacing: 2
                Repeater {
                    model: root.weekDays
                    LogosText { text: modelData; color: root.cSub; font.pixelSize: 11; font.weight: Theme.typography.weightMedium; horizontalAlignment: Text.AlignHCenter; Layout.fillWidth: true }
                }
            }

            GridLayout {
                id: grid
                visible: root.calMode === "month"
                Layout.fillWidth: true; Layout.fillHeight: true   // month fills the pane now
                Layout.leftMargin: Theme.spacing.medium; Layout.rightMargin: Theme.spacing.medium
                Layout.topMargin: 4; Layout.bottomMargin: Theme.spacing.medium
                columns: 7; rowSpacing: 2; columnSpacing: 2

                Repeater {
                    model: 42
                    delegate: Rectangle {
                        id: cell
                        Layout.fillWidth: true; Layout.fillHeight: true
                        radius: 10
                        property date cellDate: {
                            var first = new Date(root.viewMonth.getFullYear(), root.viewMonth.getMonth(), 1)
                            var offset = (first.getDay() + 6) % 7
                            return new Date(first.getFullYear(), first.getMonth(), 1 - offset + index)
                        }
                        property bool inMonth: cellDate.getMonth() === root.viewMonth.getMonth()
                        property bool isToday: root.sameDay(cellDate, new Date())
                        property bool isSel: root.sameDay(cellDate, root.selectedDay)
                        color: isSel ? root.cSurface : (cellMA.containsMouse ? root.cMantle : "transparent")
                        border.width: isSel ? 1 : 0
                        border.color: root.cBlue

                        Column {
                            anchors.left: parent.left; anchors.top: parent.top; anchors.right: parent.right; anchors.margins: 7; spacing: 4
                            // today = a filled accent circle behind the date (Google-style); else a plain number
                            Rectangle {
                                width: 22; height: 22; radius: 11
                                color: cell.isToday ? root.cYellow : "transparent"
                                LogosText {
                                    anchors.centerIn: parent
                                    text: cell.cellDate.getDate()
                                    color: cell.isToday ? root.cCrust : (cell.inMonth ? root.cText : root.cFaint)
                                    font.pixelSize: 13
                                    font.weight: cell.isToday ? Theme.typography.weightMedium : Font.Normal
                                }
                            }
                            Row {
                                spacing: 3
                                Repeater {
                                    model: root.dotsOnDay(cell.cellDate)
                                    Rectangle { width: 6; height: 6; radius: 3; color: modelData }
                                }
                            }
                        }
                        MouseArea { id: cellMA; anchors.fill: parent; hoverEnabled: true; onClicked: root.selectedDay = cell.cellDate }
                        DropArea {
                            anchors.fill: parent
                            onEntered: cell.color = root.cSurface2
                            onExited: if (!cell.isSel) cell.color = "transparent"
                            onDropped: function (drop) {
                                if (!cell.isSel) cell.color = "transparent"
                                if (drop.source && drop.source.dragEv) root.moveEventToDay(drop.source.dragEv, cell.cellDate)
                            }
                        }
                    }
                }
            }

            // ── week grid: 7 day-columns, each listing its events (plan a week of nights) ──
            RowLayout {
                visible: root.calMode === "week"
                Layout.fillWidth: true; Layout.fillHeight: true
                Layout.leftMargin: Theme.spacing.medium; Layout.rightMargin: Theme.spacing.medium
                Layout.topMargin: 4; Layout.bottomMargin: Theme.spacing.medium; spacing: 4
                Repeater {
                    model: root.calMode === "week" ? root.weekDaysOf(root.selectedDay) : []
                    Rectangle {
                        Layout.fillWidth: true; Layout.fillHeight: true; radius: 10
                        property bool isToday: root.sameDay(modelData, new Date())
                        property bool isSel: root.sameDay(modelData, root.selectedDay)
                        color: isSel ? root.cSurface : root.cMantle
                        border.width: isSel ? 1 : 0; border.color: root.cBlue
                        ColumnLayout {
                            anchors.fill: parent; anchors.margins: 6; spacing: 4
                            RowLayout {
                                Layout.fillWidth: true; spacing: 4
                                LogosText { text: root.weekDays[index]; color: root.cSub; font.pixelSize: 10; font.weight: Theme.typography.weightMedium }
                                Item { Layout.fillWidth: true }
                                Rectangle {
                                    width: 20; height: 20; radius: 10; color: isToday ? root.cYellow : "transparent"
                                    LogosText { anchors.centerIn: parent; text: modelData.getDate(); color: isToday ? root.cCrust : root.cText; font.pixelSize: 12; font.weight: isToday ? Theme.typography.weightMedium : Font.Normal }
                                }
                            }
                            Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2 }
                            ListView {
                                Layout.fillWidth: true; Layout.fillHeight: true; clip: true; spacing: 3
                                model: root.eventsOnDay(modelData)
                                delegate: Rectangle {
                                    width: ListView.view.width; implicitHeight: 34; radius: 7
                                    color: wkEvMA.containsMouse ? root.cSurface2 : root.cSurface
                                    RowLayout {
                                        anchors.fill: parent; anchors.leftMargin: 5; anchors.rightMargin: 5; spacing: 4
                                        Rectangle { width: 3; height: 22; radius: 1.5; color: root.evColor(modelData); Layout.alignment: Qt.AlignVCenter }
                                        ColumnLayout {
                                            Layout.fillWidth: true; spacing: 0
                                            LogosText { text: root.rsvpMark(modelData) + (modelData.title || "(untitled)"); color: root.myRsvpOf(modelData) === "no" ? root.cSub : root.cText; font.strikeout: root.myRsvpOf(modelData) === "no"; font.pixelSize: 11; elide: Text.ElideRight; Layout.fillWidth: true }
                                            LogosText { text: root.fmtTime(modelData.startTime); color: root.cSub; font.pixelSize: 9; elide: Text.ElideRight; Layout.fillWidth: true }
                                        }
                                    }
                                    MouseArea { id: wkEvMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.openEditEvent(modelData) }
                                }
                            }
                            LogosText {
                                text: "+"; color: root.cFaint; font.pixelSize: 16; Layout.alignment: Qt.AlignHCenter
                                MouseArea { anchors.fill: parent; anchors.margins: -6; cursorShape: Qt.PointingHandCursor
                                    onClicked: { root.selectedDay = modelData; root.openNewEvent() } }
                            }
                        }
                        MouseArea { anchors.fill: parent; z: -1; onClicked: root.selectedDay = modelData }
                    }
                }
            }

            // ── day timeline: all-day band + hour-bucketed schedule for the selected day ──
            ColumnLayout {
                visible: root.calMode === "day"
                Layout.fillWidth: true; Layout.fillHeight: true
                Layout.leftMargin: Theme.spacing.medium; Layout.rightMargin: Theme.spacing.medium
                Layout.topMargin: 4; Layout.bottomMargin: Theme.spacing.medium; spacing: 6

                Flow {
                    Layout.fillWidth: true; spacing: 6
                    visible: root.calMode === "day" && root.dayAllDay(root.selectedDay).length > 0
                    Repeater {
                        model: root.calMode === "day" ? root.dayAllDay(root.selectedDay) : []
                        delegate: Rectangle {
                            radius: 8; color: root.cSurface; border.width: 1; border.color: root.cSurface2
                            implicitWidth: adRow.implicitWidth + 16; height: 30
                            Row {
                                id: adRow; anchors.verticalCenter: parent.verticalCenter; anchors.left: parent.left; anchors.leftMargin: 8; spacing: 6
                                Rectangle { width: 3; height: 16; radius: 1.5; color: root.evColor(modelData); anchors.verticalCenter: parent.verticalCenter }
                                LogosText { text: root.rsvpMark(modelData) + (modelData.title || "(untitled)"); color: root.myRsvpOf(modelData) === "no" ? root.cSub : root.cText; font.strikeout: root.myRsvpOf(modelData) === "no"; font.pixelSize: 12; anchors.verticalCenter: parent.verticalCenter }
                            }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.openEditEvent(modelData) }
                        }
                    }
                }

                Flickable {
                    Layout.fillWidth: true; Layout.fillHeight: true; clip: true
                    contentHeight: hourCol.height; boundsBehavior: Flickable.StopAtBounds
                    ScrollBar.vertical: ScrollBar {}
                    Column {
                        id: hourCol; width: parent.width; spacing: 0
                        Repeater {
                            model: root.calMode === "day" ? root.dayTimeline(root.selectedDay) : []
                            delegate: Row {
                                width: hourCol.width; spacing: 8
                                property var rowItems: modelData.items
                                property bool nowHour: root.sameDay(root.selectedDay, new Date()) && new Date().getHours() === modelData.hour
                                LogosText { width: 46; text: root.hh(modelData.hour); color: parent.nowHour ? root.cYellow : root.cSub; font.pixelSize: 11; topPadding: 8; font.weight: parent.nowHour ? Theme.typography.weightBold : Font.Normal }
                                Column {
                                    width: hourCol.width - 54; spacing: 6; topPadding: 6; bottomPadding: 6
                                    Rectangle { width: parent.width; height: 1; color: root.cSurface2 }
                                    Repeater {
                                        model: rowItems
                                        delegate: Rectangle {
                                            width: parent.width; radius: 10; color: evMA2.containsMouse ? root.cSurface2 : root.cSurface
                                            border.width: 1; border.color: root.cSurface2
                                            implicitHeight: evCol2.implicitHeight + 16
                                            Rectangle { anchors.left: parent.left; anchors.top: parent.top; anchors.bottom: parent.bottom; anchors.margins: 6; width: 3; radius: 1.5; color: root.evColor(modelData) }
                                            Column {
                                                id: evCol2
                                                anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                                                anchors.leftMargin: 16; anchors.rightMargin: 10; spacing: 2
                                                LogosText { text: root.rsvpMark(modelData) + (modelData.title || "(untitled)"); color: root.myRsvpOf(modelData) === "no" ? root.cSub : root.cText; font.strikeout: root.myRsvpOf(modelData) === "no"; font.pixelSize: 14; font.weight: Theme.typography.weightMedium; elide: Text.ElideRight; width: parent.width }
                                                LogosText { text: root.fmtTime(modelData.startTime) + " – " + root.fmtTime(modelData.endTime) + (modelData.location ? " · " + modelData.location : ""); color: root.cSub; font.pixelSize: 12; elide: Text.ElideRight; width: parent.width }
                                            }
                                            MouseArea { id: evMA2; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onClicked: root.openEditEvent(modelData) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            }
        }

        // ── pane 3: agenda (resizable) ─────────────────────────────────────
        Rectangle {
            SplitView.preferredWidth: 320
            SplitView.minimumWidth: 220
            color: root.cMantle
            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spacing.medium
                spacing: Theme.spacing.small

                // Search — matches title/location/notes/calendar/fields across ALL dates; when filled,
                // the list below shows results (with each event's date) instead of the selected day.
                Rectangle {
                    Layout.fillWidth: true; implicitHeight: 34; radius: 9
                    color: root.cBase; border.width: 1; border.color: searchField.activeFocus ? root.cBlue : root.cSurface2
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: 10; anchors.rightMargin: 6; spacing: 6
                        LogosText { text: "🔍"; font.pixelSize: 12; color: root.cSub }
                        TextField {
                            id: searchField
                            Layout.fillWidth: true; placeholderText: "Search events…"
                            color: root.cText; font.pixelSize: 13; background: Item {}
                            onTextChanged: root.searchQuery = text
                        }
                        LogosText {
                            visible: root.searchQuery.length > 0; text: "✕"; color: root.cSub; font.pixelSize: 13
                            MouseArea { anchors.fill: parent; anchors.margins: -4; cursorShape: Qt.PointingHandCursor; onClicked: { searchField.text = ""; root.searchQuery = "" } }
                        }
                    }
                }
                LogosText {
                    text: root.searching ? (root.searchResults.length + " result" + (root.searchResults.length === 1 ? "" : "s")) : Qt.formatDate(root.selectedDay, "dddd")
                    color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium
                }
                LogosText {
                    text: root.searching ? ("for “" + root.searchQuery.trim() + "”") : Qt.formatDate(root.selectedDay, "MMMM d, yyyy")
                    color: root.cSub; font.pixelSize: 13; elide: Text.ElideRight; Layout.fillWidth: true
                }
                Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2 }

                Item {
                    Layout.fillWidth: true; Layout.fillHeight: true
                    ListView {
                        id: dayList
                        anchors.fill: parent; clip: true
                        model: root.searching ? root.searchResults : root.eventsOnDay(root.selectedDay)
                        spacing: Theme.spacing.small
                        delegate: Rectangle {
                            width: dayList.width; implicitHeight: Math.max(62, cardCol.implicitHeight + 2 * Theme.spacing.small); radius: 12
                            color: evMA.containsMouse ? root.cSurface2 : root.cSurface
                            RowLayout {
                                anchors.fill: parent; anchors.margins: Theme.spacing.small; spacing: Theme.spacing.small
                                Rectangle { width: 4; height: 42; radius: 2; color: root.evColor(modelData); Layout.alignment: Qt.AlignTop; Layout.topMargin: 2 }
                                ColumnLayout {
                                    id: cardCol
                                    Layout.fillWidth: true; spacing: 2
                                    LogosText { text: root.rsvpMark(modelData) + (modelData.title || "(untitled)"); color: root.myRsvpOf(modelData) === "no" ? root.cSub : root.cText; font.strikeout: root.myRsvpOf(modelData) === "no"; font.pixelSize: 14; font.weight: Theme.typography.weightMedium; elide: Text.ElideRight; Layout.fillWidth: true }
                                    LogosText {
                                        text: (root.searching ? Qt.formatDate(new Date(modelData.startTime), "ddd MMM d") + " · " : "") + root.fmtTime(modelData.startTime) + " – " + root.fmtTime(modelData.endTime)
                                        color: root.cSub; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true
                                    }
                                    LogosText {
                                        text: root.calName(modelData.calendarId); visible: text.length > 0
                                        color: root.calColor(modelData.calendarId); font.pixelSize: 11; elide: Text.ElideRight; Layout.fillWidth: true
                                    }
                                    Flow {
                                        visible: root.fieldValues(modelData).length > 0
                                        Layout.fillWidth: true; Layout.topMargin: 1; spacing: 4
                                        Repeater {
                                            model: root.fieldValues(modelData)
                                            Rectangle {
                                                width: badgeT.implicitWidth + 12; height: 16; radius: 5; color: root.cSurface2
                                                LogosText { id: badgeT; anchors.centerIn: parent; text: modelData; color: root.cText; font.pixelSize: 10 }
                                            }
                                        }
                                    }
                                }
                            }
                            MouseArea {
                                id: evMA; anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor
                                property bool dragging: false; property real px: 0; property real py: 0
                                onPressed: function (m) { px = m.x; py = m.y; dragging = false }
                                onPositionChanged: function (m) {
                                    if (!pressed) return
                                    if (!dragging && (Math.abs(m.x - px) + Math.abs(m.y - py)) < 8) return
                                    if (!dragging) { dragging = true; dragProxy.dragEv = modelData; dragProxy.visible = true }
                                    var gp = mapToItem(root, m.x, m.y)
                                    dragProxy.x = gp.x - dragProxy.width / 2; dragProxy.y = gp.y - dragProxy.height / 2
                                }
                                onReleased: function (m) {
                                    if (dragging) { dragProxy.Drag.drop(); dragProxy.visible = false; dragProxy.dragEv = null; dragging = false }
                                    else root.openEditEvent(modelData)
                                }
                            }
                        }
                    }
                    LogosText {
                        anchors.centerIn: parent; width: parent.width - 20
                        visible: dayList.count === 0
                        text: root.searching ? "No events match your search." : "No events on this day.\nClick “+ Event” to add one."
                        horizontalAlignment: Text.AlignHCenter; wrapMode: Text.WordWrap
                        color: root.cFaint; font.pixelSize: 13
                    }
                }
            }
        }
    }

    // ── event editor popup ─────────────────────────────────────────────────
    property var editingEvent: null       // null = creating
    property string editCalId: ""
    property string lastCalId: ""           // remember last calendar an event was created in → preselect it
    property var evCals: []                 // cached writable-calendar list for the event modal's picker (stable → currentIndex resolves)
    // Two-rule permissions (mirror the fold): owner/editors do anything; viewers read-only;
    // everyone else may ADD iff Open, and edit/delete only the events they authored.
    // Permission checks must use the LOAM identity that actually authors on THIS calendar (its bound
    // identity), not scala's core getIdentity — events are signed via loam_core now (loam ADR 0004).
    // calAddr[calId] = that address; falls back to the default identity's address.
    property var calAddr: ({})
    function defaultAddr() { for (var i = 0; i < identities.length; i++) if (identities[i].id === defaultIdentityId) return identities[i].address; return "" }
    function addrFor(c) { return (c && root.calAddr[c.id]) ? root.calAddr[c.id] : defaultAddr() }
    function isEditorMe(c) { if (!c) return true; var a = addrFor(c); if (c.owner === a) return true; var r = c.roles || {}; return r[a] === "editor" || r[a] === "admin" }
    function isViewerMe(c) { if (!c) return false; return (c.roles || {})[addrFor(c)] === "viewer" }
    function canAddTo(c) { if (isEditorMe(c)) return true; if (isViewerMe(c)) return false; return !c || c.open !== false }
    function canEditEvent(c, ev) { if (isEditorMe(c)) return true; if (isViewerMe(c)) return false; if (c && c.collab) return true; return !!ev && ev.creatorId === addrFor(c) }
    // Access tier (ADR 0019) — the three valid {open,collab} combos, presented as one choice so the
    // off-ladder "collaborative + closed" state can't be created. Closed→Open→Collaborative is a ladder.
    function calTierOf(c) { if (c && c.collab) return "collaborative"; if (!c || c.open !== false) return "open"; return "closed" }
    function calTierMeta(tier) {
        if (tier === "collaborative") return { open: true, collab: true }
        if (tier === "open") return { open: true, collab: false }
        return { open: false, collab: false } // closed
    }
    readonly property var accessTiers: [
        { tier: "closed",        title: "Closed",        desc: "Only editors add events; everyone edits only their own." },
        { tier: "open",          title: "Open",          desc: "Anyone you invite can add events; everyone edits only their own." },
        { tier: "collaborative", title: "Collaborative", desc: "Anyone you invite can add — and edit or delete ANY event." }
    ]
    // Event editor read-only: a NEW event needs add rights; an EXISTING event needs edit
    // rights on THAT event (yours, or you're an editor). Reactive to editCalId/editingEvent.
    readonly property bool eventReadOnly: editingEvent ? !canEditEvent(calById(editCalId), editingEvent) : !canAddTo(calById(editCalId))
    // Human "why can't I edit this" (ADR 0013). Desktop is single-identity, so the signing address
    // is myIdentity; when desktop gains per-calendar identities, resolve the bound one here.
    function readonlyReason(c, ev) {
        if (!c) return ""
        var a = root.addrFor(c)
        if (isViewerMe(c)) return "You're a viewer on \"" + c.name + "\" — read-only."
        if (ev && ev.creatorId && !isEditorMe(c) && ev.creatorId !== a)
            return "Only the author can edit this event (created by " + shortAuthor(ev.creatorId) + "). You're signing as " + shortAuthor(a) + "."
        if (c.owner && a !== c.owner && !isEditorMe(c))
            return "This calendar is owned by " + shortAuthor(c.owner) + ", but you're signing as " + shortAuthor(a) + ". Make a new calendar, or bind an identity that owns or can edit it."
        if (c.open === false && !isEditorMe(c))
            return "\"" + c.name + "\" is closed — only its owner/editors can add events. You're signing as " + shortAuthor(a) + "."
        return "You can't write to \"" + c.name + "\" as " + shortAuthor(a) + "."
    }
    // Inline validation — empty string == valid. Bound to the Save button + an error line.
    function eventError() {
        if (evTitle.text.trim() === "") return "Title is required."
        if (!/^\d{4}-\d{2}-\d{2}$/.test(evDate.text.trim())) return "Date must be YYYY-MM-DD."
        if (!root.evAllDay) {
            if (!/^\d{1,2}:\d{2}$/.test(evStart.text.trim())) return "Start time must be HH:MM."
            if (!/^\d{1,2}:\d{2}$/.test(evEnd.text.trim())) return "End time must be HH:MM."
        }
        return ""
    }
    property var evHistory: []             // getEventHistory result while editing
    property string evMyRsvp: ""           // ADR 0021: my optimistic attendance on the event being edited

    // ── richer-editor state (null-safe: absent on old events) ──
    property bool evAllDay: false
    property int evReminder: 10           // minutes before; 0 = none
    property string evRecurFreq: ""       // "" = does not repeat | daily/weekly/monthly/yearly
    readonly property var reminderOpts: [{ l: "None", v: 0 }, { l: "10 min", v: 10 }, { l: "30 min", v: 30 }, { l: "1 hour", v: 60 }, { l: "1 day", v: 1440 }]
    // ── attachments (ADR 0017 — stored in Logos Storage, sealed with the calendar key) ──
    property var evAttachments: []          // refs on the current event draft: {name,mime,size,storageCid,blobId}
    property bool attachBusy: false
    property string attachMsg: ""
    property string attachPollRef: ""       // ref currently being polled (upload blobId / download cid)
    property string attachPollMode: ""      // "upload" | "download"
    function humanSize(n) { n = n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; return (n / 1048576).toFixed(1) + " MB" }
    function removeAttachment(i) { var a = root.evAttachments.slice(); a.splice(i, 1); root.evAttachments = a }
    function onAttachmentPicked(fileUrl) {
        var path = ("" + fileUrl).replace(/^file:\/\//, "")
        var name = path.split("/").pop()
        root.attachBusy = true; root.attachMsg = "Sealing + uploading " + name + "…"
        var ref = core("uploadAttachment", [root.editCalId, path, name, ""])
        if (!ref) { root.attachBusy = false; root.attachMsg = "Upload failed to start"; return }
        root.attachPollRef = ref; root.attachPollMode = "upload"; attachPoll.restart()
    }
    function openAttachment(calId, cid, name) {
        if (!cid) { root.attachMsg = "Not uploaded yet"; return }
        root.attachBusy = true; root.attachMsg = "Fetching " + (name || cid) + "…"
        var ref = core("downloadAttachment", [calId, cid, name || ""])
        if (!ref) { root.attachBusy = false; root.attachMsg = "Download failed to start"; return }
        root.attachPollRef = ref; root.attachPollMode = "download"; attachPoll.restart()
    }
    function pollAttach() {
        var r = root.j(core("attachmentStatus", [root.attachPollRef]), {})
        if (r.pending) return                      // still working — keep polling
        attachPoll.stop(); root.attachBusy = false
        if (!r.ok) { root.attachMsg = "Failed: " + (r.error || "unknown"); return }
        if (root.attachPollMode === "upload") {
            var a = root.evAttachments.slice()
            a.push({ name: r.name, mime: r.mime, size: r.size, storageCid: r.cid, blobId: r.blobId })
            root.evAttachments = a; root.attachMsg = "Attached " + r.name
        } else {
            root.attachMsg = "Saved to " + r.path
            Qt.openUrlExternally("file://" + r.path)
        }
    }
    readonly property var recurOpts: [{ l: "Does not repeat", v: "" }, { l: "Daily", v: "daily" }, { l: "Weekly", v: "weekly" }, { l: "Monthly", v: "monthly" }, { l: "Yearly", v: "yearly" }]
    // Build the recur object from the current editor controls (null when "Does not repeat").
    function buildRecur() {
        if (!root.evRecurFreq) return null
        var n = Math.max(1, Math.floor(parseInt(evRecurInterval.text) || 1))
        var o = { freq: root.evRecurFreq, interval: n }
        var u = evRecurUntil.text.trim()
        if (u !== "") { var t = Date.parse(u); if (!isNaN(t)) o.until = t }
        return o
    }
    // True when the event being edited is (part of) a recurring series.
    function editingRecurring() {
        return root.editingEvent && root.editingEvent.recur && root.editingEvent.recur.freq
    }

    // Populate evFieldsModel (declared in the event popup) from the calendar's schema,
    // seeding each row from the event's stored `fields`. Clearing+refilling recreates
    // the Repeater delegates, so every open gets fresh reactive bindings.
    function seedFieldVals(calId, ev) {
        evFieldsModel.clear()
        var sch = schemaFor(calId)
        var src = (ev && ev.fields) ? ev.fields : {}
        for (var i = 0; i < sch.length; i++) {
            var f = sch[i], k = f.key
            var has = (src[k] !== undefined && src[k] !== null)
            evFieldsModel.append({
                key: k,
                label: f.label || k,
                ftype: f.type || "text",
                opts: JSON.stringify(f.options || []),
                sval: (has && f.type !== "bool") ? String(src[k]) : "",
                bval: (f.type === "bool") ? (has ? !!src[k] : false) : false
            })
        }
    }
    // Collect custom-field values into a typed object (only meaningful when schema non-empty).
    function collectFieldVals(calId) {
        var sch = schemaFor(calId)
        var byKey = {}
        for (var j = 0; j < evFieldsModel.count; j++) {
            var it = evFieldsModel.get(j)
            byKey[it.key] = { sval: it.sval, bval: it.bval }
        }
        var out = {}
        for (var i = 0; i < sch.length; i++) {
            var f = sch[i], row = byKey[f.key] || { sval: "", bval: false }
            if (f.type === "number") out[f.key] = (row.sval === "") ? 0 : parseFloat(row.sval)
            else if (f.type === "bool") out[f.key] = !!row.bval
            else out[f.key] = String(row.sval || "")
        }
        return out
    }
    function openNewEvent() {
        var w = writableCalendars()
        if (w.length === 0) { newCalPopup.open(); return }
        editingEvent = null
        root.evCals = w
        // Preselect the calendar you last added an event to (if still writable), else the first.
        var pre = w[0].id
        if (root.lastCalId !== "") { for (var k = 0; k < w.length; k++) if (w[k].id === root.lastCalId) { pre = root.lastCalId; break } }
        editCalId = pre
        evHistory = []
        var start = new Date(selectedDay); start.setHours(9, 0, 0, 0)
        var end = new Date(selectedDay); end.setHours(10, 0, 0, 0)
        evTitle.text = ""; evDate.text = fmtDateInput(start)
        evStart.text = fmtTimeInput(start); evEnd.text = fmtTimeInput(end); evNotes.text = ""
        evAllDay = false; evReminder = 10; evRecurFreq = ""
        evLocation.text = ""; evUrl.text = ""; evRecurInterval.text = "1"; evRecurUntil.text = ""
        seedFieldVals(editCalId, null)
        root.evAttachments = []; root.attachBusy = false; root.attachMsg = ""
        eventPopup.open()
    }
    // `occ` may be an expanded occurrence — series edits operate on the MASTER, so
    // load the real event (with its recurrence rule + true start date) by seriesId.
    function openEditEvent(occ) {
        var ev = occ
        root.evCals = writableCalendars()
        if (occ && occ.seriesId) { var m = root.eventById(occ.seriesId); if (m) ev = m }
        editingEvent = ev
        editCalId = ev.calendarId
        var s = new Date(ev.startTime), e = new Date(ev.endTime)
        evTitle.text = ev.title || ""; evDate.text = fmtDateInput(s)
        evStart.text = fmtTimeInput(s); evEnd.text = fmtTimeInput(e); evNotes.text = ev.description || ""
        evAllDay = !!ev.allDay
        evReminder = (ev.reminderMin !== undefined && ev.reminderMin !== null) ? ev.reminderMin : 10
        evLocation.text = ev.location || ""
        evUrl.text = ev.url || ""
        var r = ev.recur
        evRecurFreq = (r && r.freq) ? r.freq : ""
        evRecurInterval.text = (r && r.interval) ? String(r.interval) : "1"
        evRecurUntil.text = (r && typeof r.until === "number") ? fmtDateInput(new Date(r.until)) : ""
        seedFieldVals(ev.calendarId, ev)
        root.evAttachments = (ev.attachments && ev.attachments.length) ? ev.attachments.slice() : []
        root.attachBusy = false; root.attachMsg = ""
        root.evMyRsvp = (ev.rsvps && ev.rsvps[root.addrFor(root.calById(ev.calendarId))]) || ""
        evHistory = root.j(core("getEventHistory", [ev.calendarId, ev.id]), [])
        eventPopup.open()
    }
    // ADR 0021: set my attendance (self-scoped); optimistic + refresh. "" retracts.
    function setRsvp(status) {
        if (!root.editingEvent) return
        var next = (root.evMyRsvp === status) ? "" : status
        root.evMyRsvp = next
        core("setRsvp", [root.editCalId, root.editingEvent.id, next])
        refresh()
    }
    // Merge my optimistic RSVP over the folded map, count a status.
    function rsvpCount(status) {
        // Read the LIVE folded event (root.events updates on poll), not the open-time snapshot, so a
        // peer's RSVP that arrives while the editor is open is counted.
        var ev = root.editingEvent ? (root.eventById(root.editingEvent.id) || root.editingEvent) : null
        var m = {}; var r = ev ? ev.rsvps : null
        if (r) for (var k in r) m[k] = r[k]
        var me = root.addrFor(root.calById(root.editCalId))
        if (me) { if (root.evMyRsvp) m[me] = root.evMyRsvp; else delete m[me] }
        var n = 0; for (var a in m) if (m[a] === status) n++
        return n
    }
    function saveEvent() {
        var s = parseDateTime(evDate.text, evStart.text)
        var e = parseDateTime(evDate.text, evEnd.text)
        if (root.evAllDay) {
            // all-day → clamp to the day's bounds so downstream code still has valid times
            s = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0)
            e = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 0, 0)
        } else if (e.getTime() <= s.getTime()) {
            e = new Date(s.getTime() + 3600000)
        }
        var hasSchema = schemaFor(editCalId).length > 0
        var recur = root.buildRecur()
        if (editingEvent) {
            var up = editingEvent
            delete up.seriesId; delete up.occ    // never persist expanded-occurrence markers
            up.title = evTitle.text.trim(); up.startTime = s.getTime(); up.endTime = e.getTime(); up.description = evNotes.text.trim()
            up.allDay = root.evAllDay
            up.location = evLocation.text.trim()
            up.url = evUrl.text.trim()
            up.reminderMin = root.evReminder
            up.recur = recur    // null clears a previous recurrence
            if (hasSchema) up.fields = collectFieldVals(editCalId)
            up.attachments = root.evAttachments
            core("updateEvent", [JSON.stringify(up)])
        } else {
            var nv = {
                title: evTitle.text.trim(), startTime: s.getTime(), endTime: e.getTime(),
                allDay: root.evAllDay, description: evNotes.text.trim(),
                location: evLocation.text.trim(), url: evUrl.text.trim(), reminderMin: root.evReminder
            }
            if (recur) nv.recur = recur
            if (hasSchema) nv.fields = collectFieldVals(editCalId)
            if (root.evAttachments.length) nv.attachments = root.evAttachments
            core("createEvent", [editCalId, JSON.stringify(nv)])
            root.lastCalId = editCalId       // preselect this calendar next time

        }
        eventPopup.close(); refresh()
    }
    // Duplicate an existing event in one click → a new event with the same fields (same time; the
    // user moves/edits it after). Frequencies: fast setup of similar nights. Needs add rights.
    function duplicateEvent() {
        if (!root.editingEvent) return
        var src = root.editingEvent
        var nv = {
            title: (src.title || "(untitled)") + " (copy)",
            startTime: src.startTime, endTime: src.endTime, allDay: !!src.allDay,
            description: src.description || "", location: src.location || "", url: src.url || "",
            reminderMin: src.reminderMin || 0
        }
        if (src.recur) nv.recur = src.recur
        if (src.fields) nv.fields = src.fields
        if (src.attachments && src.attachments.length) nv.attachments = src.attachments
        core("createEvent", [root.editCalId, JSON.stringify(nv)])
        root.lastCalId = root.editCalId
        eventPopup.close(); refresh()
        root.notify("Event duplicated")
    }
    // Drag & drop: move an event's occurrence to another day, preserving its time-of-day + duration.
    // Edits the underlying event (LWW upsert). Refuses (with a toast) if you can't edit it.
    function moveEventToDay(ev, day) {
        if (!ev || !day) return
        var s = new Date(ev.startTime)
        if (root.sameDay(s, day)) return   // dropped on its own day — no-op
        var c = root.calById(ev.calendarId)
        if (!root.canEditEvent(c, ev)) { root.notify("You can't move this event.", true); return }
        var dur = ev.endTime - ev.startTime
        var ns = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.getHours(), s.getMinutes(), 0, 0)
        var up = JSON.parse(JSON.stringify(ev))
        delete up.seriesId; delete up.occ
        up.startTime = ns.getTime(); up.endTime = ns.getTime() + dur
        core("updateEvent", [JSON.stringify(up)])
        refresh(); root.notify((ev.recur ? "Moved series to " : "Moved to ") + Qt.formatDate(ns, "MMM d"))
    }
    function deleteEvent() { if (editingEvent) deleteEventPopup.open() }   // confirm first (destructive)
    function doDeleteEvent() {
        if (editingEvent) core("deleteEvent", [editingEvent.id])
        deleteEventPopup.close(); eventPopup.close(); refresh()
    }

    // Native file picker for attachments; poll timer for the async upload/download (no blocking IPC).
    FileDialog {
        id: attachFileDialog
        title: "Choose a file to attach"
        onAccepted: root.onAttachmentPicked(attachFileDialog.selectedFile)
    }
    Timer { id: attachPoll; interval: 600; repeat: true; onTriggered: root.pollAttach() }

    // ── toast: surface outcomes/failures instead of the old silent "" swallow ──
    property string toastMsg: ""
    property bool toastErr: false
    function notify(msg, isErr) { root.toastMsg = msg; root.toastErr = !!isErr; toastTimer.restart() }
    Timer { id: toastTimer; interval: 4500; onTriggered: root.toastMsg = "" }
    Rectangle {
        visible: root.toastMsg !== ""
        z: 99999
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom; anchors.bottomMargin: 24
        width: Math.min(parent.width - 32, toastLbl.implicitWidth + 34)
        height: toastLbl.implicitHeight + 20; radius: 10
        color: root.toastErr ? root.cRed : root.cSurface
        border.width: 1; border.color: root.toastErr ? root.cRed : root.cSurface2
        LogosText {
            id: toastLbl; anchors.centerIn: parent; width: Math.min(root.width - 60, implicitWidth)
            text: root.toastMsg; color: root.toastErr ? "#ffffff" : root.cText
            font.pixelSize: 13; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter
        }
        MouseArea { anchors.fill: parent; onClicked: root.toastMsg = "" }
    }

    // Drag proxy — a floating card following the cursor while dragging an agenda event onto a day.
    Rectangle {
        id: dragProxy; z: 100000; visible: false
        width: 170; height: 40; radius: 10; opacity: 0.92
        color: root.cSurface; border.width: 1; border.color: root.cBlue
        property var dragEv: null
        Drag.active: dragProxy.visible
        Drag.hotSpot.x: width / 2; Drag.hotSpot.y: height / 2
        RowLayout {
            anchors.fill: parent; anchors.margins: 6; spacing: 5
            Rectangle { width: 3; height: 24; radius: 1.5; color: dragProxy.dragEv ? root.evColor(dragProxy.dragEv) : "transparent"; Layout.alignment: Qt.AlignVCenter }
            LogosText { text: dragProxy.dragEv ? (dragProxy.dragEv.title || "(untitled)") : ""; color: root.cText; font.pixelSize: 12; elide: Text.ElideRight; Layout.fillWidth: true; Layout.alignment: Qt.AlignVCenter }
        }
    }

    // ── iCalendar (.ics) import/export (operates on root.setCalId) ─────────────
    function onIcsExportPicked(fileUrl) {
        var path = ("" + fileUrl).replace(/^file:\/\//, "")
        var r = root.j(root.core("exportCalendarIcsFile", [root.setCalId, path]), null)
        if (r && r.ok) root.notify("Exported " + (r.events || 0) + " event(s) → " + r.path, false)
        else root.notify("Export failed: " + ((r && r.error) || "unknown"), true)
    }
    function onIcsImportPicked(fileUrl) {
        var path = ("" + fileUrl).replace(/^file:\/\//, "")
        var r = root.j(root.core("importIcsFile", [root.setCalId, path]), null)
        if (r && !r.error && typeof r.imported === "number") {
            root.notify("Imported " + r.imported + " event(s)" + (r.skipped ? (", skipped " + r.skipped) : ""), false)
            root.refresh()
        } else root.notify("Import failed: " + ((r && r.error) || "unknown"), true)
    }
    FileDialog {
        id: icsSaveDialog
        title: "Export calendar to .ics"
        fileMode: FileDialog.SaveFile
        nameFilters: ["iCalendar (*.ics)", "All files (*)"]
        onAccepted: root.onIcsExportPicked(icsSaveDialog.selectedFile)
    }
    FileDialog {
        id: icsOpenDialog
        title: "Import events from .ics"
        nameFilters: ["iCalendar (*.ics)", "All files (*)"]
        onAccepted: root.onIcsImportPicked(icsOpenDialog.selectedFile)
    }

    Popup {
        id: eventPopup
        anchors.centerIn: Overlay.overlay
        width: 500; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: root.editingEvent ? "Edit event" : "New event"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }

            LogosText { text: "Calendar"; color: root.cFaint; font.pixelSize: 11 }
            ComboBox {
                id: evCalSelect
                Layout.fillWidth: true
                enabled: !root.editingEvent        // can't move an event to another calendar
                opacity: enabled ? 1 : 0.6
                model: root.evCals
                textRole: "name"
                currentIndex: {
                    var m = root.evCals
                    for (var i = 0; i < m.length; i++) if (m[i].id === root.editCalId) return i
                    return -1
                }
                onActivated: function (index) {
                    var m = root.evCals
                    if (index >= 0 && index < m.length) {
                        root.editCalId = m[index].id
                        // Re-seed custom fields for the newly-picked calendar — its schema
                        // differs, so the inputs must rebuild (else fields never show unless
                        // the target calendar happened to be the one seeded on open).
                        seedFieldVals(root.editCalId, editingEvent)
                    }
                }
                contentItem: LogosText {
                    leftPadding: 10; rightPadding: 28
                    text: evCalSelect.displayText || "(calendar)"
                    color: root.cText; font.pixelSize: 14
                    verticalAlignment: Text.AlignVCenter; elide: Text.ElideRight
                }
                background: Rectangle {
                    implicitHeight: 34; radius: Theme.spacing.radiusSmall; color: root.cBase
                    border.width: 1; border.color: root.cSurface2
                }
                delegate: ItemDelegate {
                    width: evCalSelect.width
                    highlighted: evCalSelect.highlightedIndex === index
                    contentItem: RowLayout {
                        spacing: 6
                        Rectangle { width: 10; height: 10; radius: 5; color: root.calColor(modelData.id); Layout.alignment: Qt.AlignVCenter }
                        LogosText { text: modelData.name || "(cal)"; color: root.cText; font.pixelSize: 14; elide: Text.ElideRight; Layout.fillWidth: true }
                    }
                    background: Rectangle { color: highlighted ? root.cSurface : root.cSurface }
                }
                popup: Popup {
                    y: evCalSelect.height
                    width: evCalSelect.width
                    implicitHeight: Math.min(contentItem.implicitHeight + 2, 260)
                    padding: 1
                    background: Rectangle { radius: Theme.spacing.radiusSmall; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
                    contentItem: ListView {
                        clip: true
                        implicitHeight: contentHeight
                        model: evCalSelect.popup.visible ? evCalSelect.delegateModel : null
                        currentIndex: evCalSelect.highlightedIndex
                        ScrollIndicator.vertical: ScrollIndicator {}
                    }
                }
            }

            LogosText { text: "Title"; color: root.cFaint; font.pixelSize: 11 }
            Field { id: evTitle; readOnly: root.eventReadOnly; Layout.fillWidth: true; placeholderText: "Event title" }

            // all-day toggle — hides the time inputs when on
            Row {
                spacing: 8
                Rectangle {
                    width: 22; height: 22; radius: 5
                    color: root.evAllDay ? root.cBlue : root.cBase
                    border.width: 1; border.color: root.cSurface2
                    LogosText { anchors.centerIn: parent; visible: root.evAllDay; text: "✓"; color: root.cBase; font.pixelSize: 14 }
                    MouseArea { anchors.fill: parent; onClicked: root.evAllDay = !root.evAllDay }
                }
                LogosText { text: "All-day"; color: root.cText; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                ColumnLayout { Layout.fillWidth: true; LogosText { text: "Date"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: evDate; readOnly: true; Layout.fillWidth: true; placeholderText: "YYYY-MM-DD"
                        MouseArea { anchors.fill: parent; enabled: !root.eventReadOnly; cursorShape: Qt.PointingHandCursor; onClicked: datePicker.openFor(evDate, evDate.text) } } }
                ColumnLayout { visible: !root.evAllDay; LogosText { text: "Start"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: evStart; readOnly: true; Layout.preferredWidth: 80; placeholderText: "HH:MM"
                        MouseArea { anchors.fill: parent; enabled: !root.eventReadOnly; cursorShape: Qt.PointingHandCursor; onClicked: timePicker.openFor(evStart, evStart.text) } } }
                ColumnLayout { visible: !root.evAllDay; LogosText { text: "End"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: evEnd; readOnly: true; Layout.preferredWidth: 80; placeholderText: "HH:MM"
                        MouseArea { anchors.fill: parent; enabled: !root.eventReadOnly; cursorShape: Qt.PointingHandCursor; onClicked: timePicker.openFor(evEnd, evEnd.text) } } }
            }

            LogosText { text: "Notes"; color: root.cFaint; font.pixelSize: 11 }
            Field { id: evNotes; readOnly: root.eventReadOnly; Layout.fillWidth: true; placeholderText: "Optional" }

            LogosText { text: "Location"; color: root.cFaint; font.pixelSize: 11 }
            Field { id: evLocation; readOnly: root.eventReadOnly; Layout.fillWidth: true; placeholderText: "Where" }

            LogosText { text: "Meeting link"; color: root.cFaint; font.pixelSize: 11 }
            Field {
                id: evUrl; readOnly: root.eventReadOnly; Layout.fillWidth: true; placeholderText: "https://…"
                inputMethodHints: Qt.ImhNoAutoUppercase | Qt.ImhUrlCharactersOnly
            }

            // ── attachments (Logos Storage, sealed with the calendar key) ──
            LogosText { text: "Attachments"; color: root.cFaint; font.pixelSize: 11 }
            Repeater {
                model: root.evAttachments
                delegate: RowLayout {
                    Layout.fillWidth: true; spacing: 6
                    LogosText {
                        Layout.fillWidth: true
                        text: "📎 " + (modelData.name || "file") + (modelData.size ? "  (" + root.humanSize(modelData.size) + ")" : "")
                        color: root.cBlue; font.pixelSize: 13; elide: Text.ElideMiddle
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                            onClicked: root.openAttachment(root.editCalId, modelData.storageCid, modelData.name) }
                    }
                    LogosText {
                        visible: !root.eventReadOnly; text: "✕"; color: root.cYellow; font.pixelSize: 14
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.removeAttachment(index) }
                    }
                }
            }
            LogosText { visible: root.attachMsg !== ""; text: root.attachMsg; color: root.cSub; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true }
            LogosButton {
                visible: !root.eventReadOnly
                text: root.attachBusy ? "Working…" : "＋ Attach file"
                enabled: !root.attachBusy
                onClicked: attachFileDialog.open()
            }

            // reminder chips
            LogosText { text: "Reminder"; color: root.cFaint; font.pixelSize: 11 }
            Flow {
                Layout.fillWidth: true; spacing: 6
                Repeater {
                    model: root.reminderOpts
                    delegate: Rectangle {
                        height: 28; radius: 14; width: remLbl.width + 20
                        color: root.evReminder === modelData.v ? root.cSurface : root.cBase
                        border.width: 1
                        border.color: root.evReminder === modelData.v ? root.cBlue : root.cSurface2
                        LogosText { id: remLbl; anchors.centerIn: parent; text: modelData.l; color: root.cText; font.pixelSize: 13 }
                        MouseArea { anchors.fill: parent; onClicked: root.evReminder = modelData.v }
                    }
                }
            }

            // recurrence
            LogosText { text: "Repeat"; color: root.cFaint; font.pixelSize: 11 }
            Flow {
                Layout.fillWidth: true; spacing: 6
                Repeater {
                    model: root.recurOpts
                    delegate: Rectangle {
                        height: 28; radius: 14; width: recLbl.width + 20
                        color: root.evRecurFreq === modelData.v ? root.cSurface : root.cBase
                        border.width: 1
                        border.color: root.evRecurFreq === modelData.v ? root.cBlue : root.cSurface2
                        LogosText { id: recLbl; anchors.centerIn: parent; text: modelData.l; color: root.cText; font.pixelSize: 13 }
                        MouseArea { anchors.fill: parent; onClicked: root.evRecurFreq = modelData.v }
                    }
                }
            }
            RowLayout {
                visible: root.evRecurFreq !== ""
                Layout.fillWidth: true; spacing: Theme.spacing.small
                ColumnLayout { LogosText { text: "Every N"; color: root.cFaint; font.pixelSize: 11 } Field { id: evRecurInterval; Layout.preferredWidth: 70; text: "1"; inputMethodHints: Qt.ImhFormattedNumbersOnly; placeholderText: "1" } }
                ColumnLayout { Layout.fillWidth: true; LogosText { text: "Until (optional)"; color: root.cFaint; font.pixelSize: 11 } Field { id: evRecurUntil; Layout.fillWidth: true; placeholderText: "YYYY-MM-DD" } }
            }
            LogosText {
                visible: root.evRecurFreq !== ""
                text: root.recurLabel(root.buildRecur())
                color: root.cSub; font.pixelSize: 12
            }

            // note when editing a recurring series
            LogosText {
                visible: !!root.editingRecurring()
                text: "Part of a repeating event — changes apply to the whole series."
                color: root.cFaint; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
            }

            // ── custom fields (schema-driven) — nothing rendered for a plain calendar ──
            ListModel { id: evFieldsModel }
            Repeater {
                model: evFieldsModel
                delegate: ColumnLayout {
                    id: fieldRow
                    Layout.fillWidth: true; Layout.topMargin: 2; spacing: 3
                    property int rowIndex: index
                    property string curVal: model.sval        // reactive: updates on setProperty
                    property bool curBool: model.bval
                    property string optsJson: model.opts
                    LogosText {
                        text: (model.label || model.key) + (model.ftype === "number" ? " (number)" : (model.ftype === "url" ? " (url)" : ""))
                        color: root.cFaint; font.pixelSize: 11
                    }
                    // bool → checkbox toggle
                    Row {
                        visible: model.ftype === "bool"
                        spacing: 8
                        Rectangle {
                            width: 22; height: 22; radius: 5
                            color: fieldRow.curBool ? root.cBlue : root.cBase
                            border.width: 1; border.color: root.cSurface2
                            LogosText { anchors.centerIn: parent; visible: fieldRow.curBool; text: "✓"; color: root.cBase; font.pixelSize: 14 }
                            MouseArea { anchors.fill: parent; onClicked: evFieldsModel.setProperty(fieldRow.rowIndex, "bval", !fieldRow.curBool) }
                        }
                        LogosText { text: fieldRow.curBool ? "Yes" : "No"; color: root.cText; font.pixelSize: 13; anchors.verticalCenter: parent.verticalCenter }
                    }
                    // enum → selectable chips from options
                    Flow {
                        visible: model.ftype === "enum"
                        Layout.fillWidth: true; spacing: 6
                        Repeater {
                            model: JSON.parse(fieldRow.optsJson || "[]")
                            delegate: Rectangle {
                                height: 28; radius: 14; width: chipLbl.width + 20
                                color: fieldRow.curVal === modelData ? root.cSurface : root.cBase
                                border.width: 1
                                border.color: fieldRow.curVal === modelData ? root.cBlue : root.cSurface2
                                LogosText { id: chipLbl; anchors.centerIn: parent; text: modelData; color: root.cText; font.pixelSize: 13 }
                                MouseArea { anchors.fill: parent; onClicked: evFieldsModel.setProperty(fieldRow.rowIndex, "sval", modelData) }
                            }
                        }
                    }
                    // everything else → a Field (numeric for number, no autocapitalize for url)
                    Field {
                        visible: model.ftype !== "bool" && model.ftype !== "enum"
                        Layout.fillWidth: true
                        text: model.sval
                        inputMethodHints: model.ftype === "number" ? Qt.ImhFormattedNumbersOnly
                                          : (model.ftype === "url" ? (Qt.ImhNoAutoUppercase | Qt.ImhUrlCharactersOnly) : Qt.ImhNone)
                        placeholderText: model.ftype === "date" ? "YYYY-MM-DD"
                                         : (model.ftype === "datetime" ? "YYYY-MM-DD HH:MM"
                                         : (model.ftype === "color" ? "#rrggbb"
                                         : (model.ftype === "url" ? "https://…" : "")))
                        onTextChanged: evFieldsModel.setProperty(fieldRow.rowIndex, "sval", text)
                    }
                }
            }

            // ── RSVP (ADR 0021) — your own attendance; any member can set it ──
            ColumnLayout {
                visible: root.editingEvent !== null
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: 4
                LogosText { text: "Your RSVP"; color: root.cFaint; font.pixelSize: 11 }
                Flow {
                    Layout.fillWidth: true; spacing: 6
                    Repeater {
                        model: [{ k: "going", l: "Going" }, { k: "maybe", l: "Maybe" }, { k: "no", l: "No" }]
                        delegate: Rectangle {
                            height: 28; radius: 14; width: rsvpLbl.width + 20
                            color: root.evMyRsvp === modelData.k ? root.cSurface : root.cBase
                            border.width: 1
                            border.color: root.evMyRsvp === modelData.k ? root.cBlue : root.cSurface2
                            LogosText { id: rsvpLbl; anchors.centerIn: parent; text: modelData.l; color: root.cText; font.pixelSize: 13 }
                            MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.setRsvp(modelData.k) }
                        }
                    }
                }
                LogosText {
                    text: root.rsvpCount("going") + " going · " + root.rsvpCount("maybe") + " maybe · " + root.rsvpCount("no") + " no"
                    color: root.cSub; font.pixelSize: 11
                }
            }

            // ── edit history (only when editing an existing event) ──
            ColumnLayout {
                visible: root.editingEvent !== null && root.evHistory && root.evHistory.length > 0
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: 2
                LogosText { text: "History"; color: root.cFaint; font.pixelSize: 11 }
                Repeater {
                    model: root.evHistory || []
                    delegate: LogosText {
                        Layout.fillWidth: true
                        text: "· " + (modelData.action || "changed")
                              + ((modelData.action === "edited" && modelData.changed && modelData.changed.length) ? " (" + modelData.changed.join(", ") + ")" : "")
                              + " by " + root.shortAuthor(modelData.author)
                              + " — " + Qt.formatDateTime(new Date(modelData.at), "MMM d, hh:mm")
                        color: root.cSub; font.pixelSize: 11; elide: Text.ElideRight
                    }
                }
            }

            // Inline validation error (only while editable).
            LogosText {
                visible: !root.eventReadOnly && root.eventError() !== ""
                text: root.eventError()
                color: root.cYellow; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
            // Read-only reason (ADR 0013): say WHY you can't edit instead of a silent locked form.
            Rectangle {
                visible: root.eventReadOnly
                Layout.fillWidth: true; radius: Theme.spacing.radiusSmall
                color: Qt.rgba(0.98, 0.89, 0.55, 0.10); border.width: 1; border.color: root.cYellow
                implicitHeight: roLabel.implicitHeight + 2 * Theme.spacing.small
                ColumnLayout {
                    anchors.fill: parent; anchors.margins: Theme.spacing.small; spacing: 2
                    LogosText { text: "🔒 Read-only"; color: root.cYellow; font.pixelSize: 12; font.weight: Theme.typography.weightMedium }
                    LogosText {
                        id: roLabel
                        text: root.readonlyReason(root.calById(root.editCalId), root.editingEvent)
                        color: root.cYellow; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: Theme.spacing.small
                LogosButton { visible: root.editingEvent !== null && !root.eventReadOnly; text: "Delete"; onClicked: root.deleteEvent() }
                LogosButton { visible: root.editingEvent !== null && root.canAddTo(root.calById(root.editCalId)); text: "Duplicate"; onClicked: root.duplicateEvent() }
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: eventPopup.close() }
                LogosButton { visible: !root.eventReadOnly; text: root.editingEvent ? "Save" : "Create"; enabled: root.eventError() === ""; onClicked: root.saveEvent() }
            }
        }
    }

    // ── date picker (month grid) — writes YYYY-MM-DD into a target Field ───────
    Popup {
        id: datePicker
        property var targetField: null
        property date pickMonth: new Date()
        function openFor(field, curText) {
            targetField = field
            var d = /^\d{4}-\d{2}-\d{2}$/.test((curText || "").trim()) ? new Date(curText.trim() + "T00:00:00") : new Date()
            pickMonth = new Date(d.getFullYear(), d.getMonth(), 1)
            open()
        }
        anchors.centerIn: Overlay.overlay
        width: 300; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            RowLayout {
                Layout.fillWidth: true
                LogosButton { text: "‹"; onClicked: datePicker.pickMonth = new Date(datePicker.pickMonth.getFullYear(), datePicker.pickMonth.getMonth() - 1, 1) }
                LogosText { Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter; text: root.monthNames[datePicker.pickMonth.getMonth()] + " " + datePicker.pickMonth.getFullYear(); color: root.cText; font.pixelSize: 15 }
                LogosButton { text: "›"; onClicked: datePicker.pickMonth = new Date(datePicker.pickMonth.getFullYear(), datePicker.pickMonth.getMonth() + 1, 1) }
            }
            Row {
                Layout.alignment: Qt.AlignHCenter
                Repeater { model: root.weekDays; delegate: LogosText { width: 38; horizontalAlignment: Text.AlignHCenter; text: modelData.substring(0, 1); color: root.cFaint; font.pixelSize: 10 } }
            }
            Grid {
                columns: 7; Layout.alignment: Qt.AlignHCenter; rowSpacing: 2; columnSpacing: 2
                Repeater {
                    model: 42
                    delegate: Rectangle {
                        width: 38; height: 32; radius: 6
                        property date cd: {
                            var first = new Date(datePicker.pickMonth.getFullYear(), datePicker.pickMonth.getMonth(), 1)
                            var offset = (first.getDay() + 6) % 7
                            return new Date(first.getFullYear(), first.getMonth(), 1 - offset + index)
                        }
                        property bool inMonth: cd.getMonth() === datePicker.pickMonth.getMonth()
                        property bool today: root.sameDay(cd, new Date())
                        color: today ? root.cSurface : "transparent"
                        border.width: today ? 1 : 0; border.color: root.cBlue
                        LogosText { anchors.centerIn: parent; text: cd.getDate(); color: inMonth ? root.cText : root.cFaint; font.pixelSize: 12 }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { if (datePicker.targetField) datePicker.targetField.text = root.fmtDateInput(cd); datePicker.close() } }
                    }
                }
            }
            LogosButton { Layout.alignment: Qt.AlignRight; text: "Cancel"; onClicked: datePicker.close() }
        }
    }

    // ── time picker (hour + minute columns) — writes HH:MM into a target Field ─
    Popup {
        id: timePicker
        property var targetField: null
        property int selHour: 9
        property int selMin: 0
        function openFor(field, curText) {
            targetField = field
            var m = /^(\d{1,2}):(\d{2})$/.exec((curText || "").trim())
            selHour = m ? Math.max(0, Math.min(23, parseInt(m[1]))) : 9
            selMin = m ? Math.max(0, Math.min(59, parseInt(m[2]))) : 0
            open()
        }
        anchors.centerIn: Overlay.overlay
        width: 260; height: 340; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: "Pick time"; color: root.cText; font.pixelSize: 15; font.weight: Theme.typography.weightMedium }
            RowLayout {
                Layout.fillWidth: true; Layout.fillHeight: true; spacing: Theme.spacing.small
                ListView {
                    id: hourList; Layout.fillWidth: true; Layout.fillHeight: true; clip: true
                    model: 24; currentIndex: timePicker.selHour
                    ScrollBar.vertical: ScrollBar {}
                    delegate: Rectangle {
                        width: ListView.view.width; height: 30; radius: 5
                        color: timePicker.selHour === index ? root.cBlue : "transparent"
                        LogosText { anchors.centerIn: parent; text: root.pad(index); color: timePicker.selHour === index ? root.cBase : root.cText; font.pixelSize: 13 }
                        MouseArea { anchors.fill: parent; onClicked: timePicker.selHour = index }
                    }
                }
                LogosText { text: ":"; color: root.cText; font.pixelSize: 18 }
                ListView {
                    id: minList; Layout.fillWidth: true; Layout.fillHeight: true; clip: true
                    model: 12; currentIndex: Math.round(timePicker.selMin / 5)
                    ScrollBar.vertical: ScrollBar {}
                    delegate: Rectangle {
                        width: ListView.view.width; height: 30; radius: 5
                        property int mv: index * 5
                        color: timePicker.selMin === mv ? root.cBlue : "transparent"
                        LogosText { anchors.centerIn: parent; text: root.pad(index * 5); color: timePicker.selMin === mv ? root.cBase : root.cText; font.pixelSize: 13 }
                        MouseArea { anchors.fill: parent; onClicked: timePicker.selMin = mv }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: timePicker.close() }
                LogosButton { text: "Set"; onClicked: { if (timePicker.targetField) timePicker.targetField.text = root.pad(timePicker.selHour) + ":" + root.pad(timePicker.selMin); timePicker.close() } }
            }
        }
    }

    // ── identities popup (loam ADR 0004: service in loam_core, UI here) ────────
    property string newIdentityLabel: ""
    Popup {
        id: identitiesPopup
        anchors.centerIn: Overlay.overlay
        width: 460; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            width: parent.width; spacing: Theme.spacing.medium
            LogosText { text: "Identities"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }
            LogosText { text: "Keys live in loam_core and never leave it. ★ = default for new calendars — tap an identity to make it the default."
                color: root.cFaint; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true }
            Repeater {
                model: root.identities
                RowLayout {
                    Layout.fillWidth: true; spacing: Theme.spacing.small
                    MouseArea {
                        Layout.fillWidth: true; implicitHeight: idCol.implicitHeight; cursorShape: Qt.PointingHandCursor
                        onClicked: { root.loamCore("setDefaultIdentityId", [modelData.id]); root.refreshIdentities() }
                        ColumnLayout {
                            id: idCol; width: parent.width; spacing: 0
                            LogosText {
                                text: (modelData.id === root.defaultIdentityId ? "★ " : "  ") + modelData.label
                                      + "  ·  " + (modelData.kind === "keycard" ? "💳 Keycard" : modelData.kind)
                                color: root.cText; font.pixelSize: 13
                            }
                            LogosText { text: (modelData.address || "").substring(0, 14) + "…" + (modelData.address || "").slice(-4); color: root.cFaint; font.pixelSize: 10; font.family: "monospace" }
                        }
                    }
                    LogosButton {
                        visible: modelData.kind === "soft"; text: "✎"
                        onClicked: { root.renameTargetId = modelData.id; renameField.text = modelData.label; idRenamePopup.open() }
                    }
                    LogosButton {
                        visible: modelData.kind === "soft" || modelData.kind === "keycard"; text: "✕"
                        // Guarded: removing an identity you sign calendars with orphans them (you can no
                        // longer author there). Confirm + warn how many, instead of firing immediately.
                        onClicked: {
                            root.idRemoveId = modelData.id; root.idRemoveKind = modelData.kind
                            root.idRemoveLabel = modelData.label; root.idRemoveAddr = modelData.address || ""
                            idRemovePopup.open()
                        }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: Theme.spacing.small
                LogosTextField { id: newIdField; Layout.fillWidth: true; placeholderText: "new software identity name"; text: root.newIdentityLabel; onTextChanged: root.newIdentityLabel = text }
                LogosButton {
                    text: "+ Add"
                    onClicked: { root.loamCore("addSoftIdentity", [newIdField.text.trim() || "Identity"]); newIdField.text = ""; root.refreshIdentities() }
                }
            }
            // Enrol a physical Keycard as a loam identity (loam owns all keycard logic; scala just
            // triggers it + shows the overlay). One card = one identity across phone + desktop.
            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                LogosTextField { id: kcLabelField; Layout.fillWidth: true; placeholderText: "Keycard identity name" }
                LogosButton {
                    text: "💳 Enroll Keycard"
                    onClicked: { root.core("enrollKeycard", [kcLabelField.text.trim() || "My Keycard", "scala"]); kcLabelField.text = ""; identitiesPopup.close() }
                }
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Close"; onClicked: identitiesPopup.close() }
            }
        }
    }

    // ── rename a soft identity ───────────────────────────────────────────────
    Popup {
        id: idRenamePopup
        anchors.centerIn: Overlay.overlay
        width: 360; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            width: parent.width; spacing: Theme.spacing.medium
            LogosText { text: "Rename identity"; color: root.cText; font.pixelSize: 16; font.weight: Theme.typography.weightMedium }
            LogosTextField { id: renameField; Layout.fillWidth: true; placeholderText: "Identity name" }
            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: idRenamePopup.close() }
                LogosButton {
                    text: "Save"
                    onClicked: {
                        var nm = renameField.text.trim()
                        if (nm.length && root.renameTargetId) { root.loamCore("renameSoftIdentity", [root.renameTargetId, nm]); root.refreshIdentities() }
                        idRenamePopup.close()
                    }
                }
            }
        }
    }

    // ── confirm identity removal (warns if it signs calendars → orphans them) ─
    Popup {
        id: idRemovePopup
        anchors.centerIn: Overlay.overlay
        width: 400; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        readonly property int owned: root.identitySignsCount(root.idRemoveAddr)
        ColumnLayout {
            width: parent.width; spacing: Theme.spacing.medium
            LogosText { text: "Remove “" + root.idRemoveLabel + "”?"; color: root.cText; font.pixelSize: 16; font.weight: Theme.typography.weightMedium; wrapMode: Text.WordWrap; Layout.fillWidth: true }
            LogosText {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; font.pixelSize: 13
                color: idRemovePopup.owned > 0 ? root.cRed : root.cFaint
                text: idRemovePopup.owned > 0
                    ? "⚠️ This identity signs " + idRemovePopup.owned + " calendar" + (idRemovePopup.owned === 1 ? "" : "s") + " on this device. Removing it orphans them — you won't be able to author there until you rebind another identity (a calendar's ⚙ → Signs as)."
                    : (root.idRemoveKind === "keycard"
                        ? "Forgets this Keycard on this device. The card itself is unchanged; re-enrol to use it again."
                        : "This soft identity's key is deleted from loam_core and cannot be recovered.")
            }
            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: idRemovePopup.close() }
                LogosButton {
                    text: idRemovePopup.owned > 0 ? "Remove anyway" : "Remove"
                    onClicked: {
                        root.loamCore(root.idRemoveKind === "keycard" ? "removeKeycardIdentity" : "removeSoftIdentity", [root.idRemoveId])
                        root.refreshIdentities()
                        idRemovePopup.close()
                    }
                }
            }
        }
    }

    // ── new-calendar popup ───────────────────────────────────────────────────
    property string newCalTier: "closed"    // access tier (ADR 0019): closed | open | collaborative — default Closed
    property string newCalIdentity: ""      // "author as" (loam identity) — "" = pick createDefaultOwner
    // The owner a NEW calendar gets when the user hasn't explicitly tapped a chip: the global default —
    // UNLESS that default is a keycard. A keycard must be an EXPLICIT choice, never the silent default,
    // or a keycard-default user is forced into a card tap just to create a calendar (and, pre-fix, trapped
    // in the sign overlay). Mirrors loam's own "a keycard default never silently signs" rule. Soft/device
    // defaults are still honored (WYSIWYG). Re-evaluates when identities/default change.
    readonly property string createDefaultOwner: {
        var d = root.defaultIdentityId
        for (var i = 0; i < root.identities.length; i++)
            if (root.identities[i].id === d) return root.identities[i].kind === "keycard" ? "device" : d
        return d
    }
    property string joinIdentity: ""         // "author as" for a joined calendar
    property string ncNewType: "text"   // staged field type in the new-calendar add-row
    // Add a custom field to the NEW-calendar schema (mirrors addSchemaField).
    function addNcField() {
        var k = ncNewKey.text.trim()
        if (k === "") return
        var opts = []
        if (root.ncNewType === "enum") {
            var parts = ncNewOptions.text.split(",")
            for (var i = 0; i < parts.length; i++) { var p = parts[i].trim(); if (p.length) opts.push(p) }
        }
        newCalSchemaModel.append({ key: k, label: ncNewLabel.text.trim() || k, ftype: root.ncNewType, opts: JSON.stringify(opts) })
        ncNewKey.text = ""; ncNewLabel.text = ""; ncNewOptions.text = ""; root.ncNewType = "text"
    }
    Popup {
        id: newCalPopup
        anchors.centerIn: Overlay.overlay
        width: 500; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        onOpened: {
            newCalName.text = ""; newCalDesc.text = ""; root.newCalTier = "closed"; root.newCalIdentity = ""
            newCalSchemaModel.clear(); ncNewKey.text = ""; ncNewLabel.text = ""; ncNewOptions.text = ""; root.ncNewType = "text"
        }
        function createNow() {
            // core returns are double-JSON-encoded — unwrap with j() (like getIdentity/
            // listCalendars) or the id comes back quoted and updateCalendarMeta targets the
            // WRONG calendar, so description/custom-fields silently never save on create.
            // Color is DERIVED from the calendar id (calColor), never chosen — pass "".
            // Bind the RESOLVED owner — the explicit pick, or (nothing picked) createDefaultOwner
            // (the global default, but never silently a keycard). WYSIWYG: the highlighted chip owns +
            // signs the calendar; a keycard only owns it if the user explicitly taps it.
            var id = String(root.j(root.core("createCalendar", [newCalName.text.trim(), "", (root.newCalIdentity || root.createDefaultOwner)]), ""))
            if (id === "") { newCalPopup.close(); root.refresh(); root.notify("Couldn't create the calendar.", true); return }
            var sch = []
            for (var i = 0; i < newCalSchemaModel.count; i++) {
                var it = newCalSchemaModel.get(i)
                var e = { key: it.key, label: it.label, type: it.ftype }
                var o = JSON.parse(it.opts || "[]")
                if (it.ftype === "enum") e.options = o
                sch.push(e)
            }
            var d = newCalDesc.text.trim()
            // Fold up the create-time meta in one cal.meta write. `open` only needs writing
            // when Restricted (open defaults to true in the fold).
            var meta = {}
            if (d !== "") meta.description = d
            if (sch.length > 0) meta.schema = sch
            // Access tier (ADR 0019) → the {open,collab} pair. Closed needs open:false written
            // explicitly (the fold defaults open=true); collaborative writes both true.
            var tm = root.calTierMeta(root.newCalTier)
            meta.open = tm.open
            meta.collab = tm.collab
            if (Object.keys(meta).length > 0) root.core("updateCalendarMeta", [id, JSON.stringify(meta)])
            newCalPopup.close(); root.refresh()
        }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small

            LogosText { text: "New calendar"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }

            Flickable {
                Layout.fillWidth: true
                Layout.preferredHeight: Math.min(contentHeight, 520)
                contentWidth: width; contentHeight: newCalBody.implicitHeight
                clip: true
                ScrollBar.vertical: ScrollBar {}
                ColumnLayout {
                    id: newCalBody
                    width: parent.width; spacing: Theme.spacing.small

                    LogosText { text: "Name"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: newCalName; Layout.fillWidth: true; placeholderText: "Calendar name" }

                    LogosText { text: "Description"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: newCalDesc; Layout.fillWidth: true; placeholderText: "Optional description" }

                    // Author as — which loam identity OWNS + signs this calendar (loam ADR 0004).
                    LogosText { text: "Author as"; color: root.cFaint; font.pixelSize: 11 }
                    Flow {
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        Repeater {
                            model: root.identities
                            Rectangle {
                                // selected = explicitly picked, or (nothing picked yet) the default. Inlined
                                // like the working field-type chips so the binding re-evaluates on click.
                                radius: Theme.spacing.radiusSmall
                                color: (root.newCalIdentity === modelData.id || (root.newCalIdentity === "" && modelData.id === root.createDefaultOwner)) ? root.cBlue : root.cSurface
                                border.width: 1
                                border.color: (root.newCalIdentity === modelData.id || (root.newCalIdentity === "" && modelData.id === root.createDefaultOwner)) ? root.cBlue : root.cSurface2
                                implicitHeight: chipT.implicitHeight + 10; implicitWidth: chipT.implicitWidth + 22
                                LogosText { id: chipT; anchors.centerIn: parent; text: modelData.label; font.pixelSize: 12; color: root.cText }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.newCalIdentity = modelData.id }
                            }
                        }
                    }
                    LogosText { text: "This identity owns the calendar and signs its events."; color: root.cFaint; font.pixelSize: 10; wrapMode: Text.WordWrap; Layout.fillWidth: true }
                    // Explain the divergence when the global default is a Keycard: we pre-select This device
                    // so creating a calendar doesn't force a card tap. Pick the Keycard chip to own it with the card.
                    LogosText {
                        visible: root.createDefaultOwner !== root.defaultIdentityId && root.newCalIdentity === ""
                        text: "Your default is a 🔑 Keycard — new calendars use This device unless you pick the card, so you're not asked to tap on every calendar."
                        color: root.cFaint; font.pixelSize: 10; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }

                    Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2; Layout.topMargin: 4 }

                    // ── custom fields editor (same as Calendar settings) ──
                    LogosText { text: "Custom fields"; color: root.cText; font.pixelSize: 14; font.weight: Theme.typography.weightMedium }
                    LogosText {
                        visible: newCalSchemaModel.count === 0
                        text: "Optional. Add typed fields to collect extra info on each event (venue, lineup…). You can also edit these later in the calendar's ⚙ settings."
                        color: root.cFaint; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }
                    Repeater {
                        model: newCalSchemaModel
                        delegate: Rectangle {
                            Layout.fillWidth: true; implicitHeight: 34; radius: Theme.spacing.radiusSmall; color: root.cMantle
                            RowLayout {
                                anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                                LogosText { text: (model.label || model.key); color: root.cText; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                                LogosText { text: model.ftype; color: root.cSub; font.pixelSize: 12 }
                                LogosText {
                                    text: "✕"; color: root.cFaint; font.pixelSize: 14
                                    MouseArea { anchors.fill: parent; anchors.margins: -4; onClicked: newCalSchemaModel.remove(index) }
                                }
                            }
                        }
                    }
                    RowLayout {
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        Field { id: ncNewKey; Layout.fillWidth: true; placeholderText: "key" }
                        Field { id: ncNewLabel; Layout.fillWidth: true; placeholderText: "label" }
                    }
                    Flow {
                        Layout.fillWidth: true; spacing: 6
                        Repeater {
                            model: root.fieldTypes
                            delegate: Rectangle {
                                height: 26; radius: 13; width: ncTLbl.width + 18
                                color: root.ncNewType === modelData ? root.cSurface : root.cBase
                                border.width: 1; border.color: root.ncNewType === modelData ? root.cBlue : root.cSurface2
                                LogosText { id: ncTLbl; anchors.centerIn: parent; text: modelData; color: root.cText; font.pixelSize: 12 }
                                MouseArea { anchors.fill: parent; onClicked: root.ncNewType = modelData }
                            }
                        }
                    }
                    Field {
                        id: ncNewOptions
                        visible: root.ncNewType === "enum"
                        Layout.fillWidth: true; placeholderText: "enum options (comma-separated)"
                    }
                    LogosButton { text: "+ Add field"; enabled: ncNewKey.text.trim().length > 0; onClicked: root.addNcField() }

                    ListModel { id: newCalSchemaModel }
                }
            }

            // Access — one 3-way tier (ADR 0019 ladder: Closed→Open→Collaborative) instead of two
            // independent toggles, so the off-ladder "collaborative + closed" combo can't be created.
            LogosText { text: "Access"; color: root.cFaint; font.pixelSize: 11; Layout.topMargin: Theme.spacing.small }
            Repeater {
                model: root.accessTiers
                Rectangle {
                    Layout.fillWidth: true
                    radius: Theme.spacing.radiusSmall
                    color: (root.newCalTier === modelData.tier) ? root.cSurface : "transparent"
                    border.width: 1
                    border.color: (root.newCalTier === modelData.tier) ? root.cBlue : root.cSurface2
                    implicitHeight: ncTierRow.implicitHeight + 2 * Theme.spacing.small
                    RowLayout {
                        id: ncTierRow
                        anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: Theme.spacing.small; spacing: Theme.spacing.small
                        Rectangle {
                            Layout.alignment: Qt.AlignTop; width: 16; height: 16; radius: 8; color: "transparent"
                            border.width: 2; border.color: (root.newCalTier === modelData.tier) ? root.cBlue : root.cSurface2
                            Rectangle { anchors.centerIn: parent; width: 8; height: 8; radius: 4; color: root.cBlue; visible: root.newCalTier === modelData.tier }
                        }
                        ColumnLayout {
                            Layout.fillWidth: true; spacing: 0
                            LogosText { text: modelData.title; color: root.cText; font.pixelSize: 13 }
                            LogosText { text: modelData.desc; color: root.cSub; font.pixelSize: 11; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                        }
                    }
                    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.newCalTier = modelData.tier }
                }
            }

            // Signatures-required — the fold DROPS any unsigned event (ADR 0015). The core enforces

            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: newCalPopup.close() }
                LogosButton {
                    text: "Create"; enabled: newCalName.text.trim().length > 0
                    onClicked: newCalPopup.createNow()
                }
            }
        }
    }

    // ── per-calendar settings popup (name/description, schema, roles) ──────────
    property string setCalId: ""
    property string calSetIdentity: ""      // the identity currently signing setCalId (for the rebind chips)
    property string setNewType: "text"      // staged field type in the add-row
    property string setNewRole: "editor"    // staged role in the add-member row

    function openCalSettings(cal) {
        setCalId = cal.id
        root.calSetIdentity = root.calendarIdentityId(cal.id)   // which identity signs my events here (rebindable)
        setName.text = cal.name || ""
        setDesc.text = cal.description || ""
        setSchemaModel.clear()
        var sch = (cal.schema && cal.schema.length) ? cal.schema : []
        for (var i = 0; i < sch.length; i++) {
            setSchemaModel.append({
                key: sch[i].key, label: sch[i].label || sch[i].key,
                ftype: sch[i].type || "text", opts: JSON.stringify(sch[i].options || [])
            })
        }
        setNewKey.text = ""; setNewLabel.text = ""; setNewOptions.text = ""; root.setNewType = "text"
        setNewMember.text = ""; root.setNewRole = "editor"
        root.setSaveError = ""
        calSettingsPopup.open()
    }
    function addSchemaField() {
        var k = setNewKey.text.trim()
        if (k === "") return
        var opts = []
        if (root.setNewType === "enum") {
            var parts = setNewOptions.text.split(",")
            for (var i = 0; i < parts.length; i++) { var p = parts[i].trim(); if (p.length) opts.push(p) }
        }
        setSchemaModel.append({
            key: k, label: setNewLabel.text.trim() || k,
            ftype: root.setNewType, opts: JSON.stringify(opts)
        })
        setNewKey.text = ""; setNewLabel.text = ""; setNewOptions.text = ""; root.setNewType = "text"
    }
    property string setSaveError: ""
    function saveCalSettings() {
        root.setSaveError = ""
        var sch = []
        for (var i = 0; i < setSchemaModel.count; i++) {
            var it = setSchemaModel.get(i)
            var e = { key: it.key, label: it.label, type: it.ftype }
            var o = JSON.parse(it.opts || "[]")
            if (it.ftype === "enum") e.options = o
            sch.push(e)
        }
        var wantKeys = []
        for (var k = 0; k < sch.length; k++) wantKeys.push(sch[k].key)
        wantKeys.sort()
        core("updateCalendarMeta", [setCalId, JSON.stringify({ name: setName.text.trim(), description: setDesc.text.trim(), schema: sch })])
        refresh()
        // VERIFY the core actually persisted it. An out-of-date core silently no-ops
        // updateCalendarMeta (added in scala 0.7.0), so a save would appear to succeed but
        // vanish — surface that instead of failing quietly.
        var now = root.calById(setCalId)
        var gotKeys = []
        if (now && now.schema) for (var g = 0; g < now.schema.length; g++) gotKeys.push(now.schema[g].key)
        gotKeys.sort()
        if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) {
            root.setSaveError = "Couldn't save — your Scala core module looks out of date. Update 'scala' to 0.8.0 in the package manager (custom fields need core 0.7.0+), then try again."
            return // keep the popup open so the message is seen
        }
        calSettingsPopup.close()
    }
    // Members = owner (not removable) + each roles entry.
    function membersFor(calId) {
        var c = calById(calId); if (!c) return []
        var out = []
        if (c.owner) out.push({ id: c.owner, role: "owner", removable: false })
        var r = c.roles || {}
        for (var key in r) { if (key === c.owner) continue; out.push({ id: key, role: r[key], removable: true }) }
        return out
    }
    function canManage(calId) {
        var c = calById(calId); if (!c) return false
        var a = root.addrFor(c); if (c.owner && c.owner === a) return true
        var r = c.roles || {}
        return r[a] === "editor" || r[a] === "admin"
    }
    function addMember() {
        var id = setNewMember.text.trim(); if (id === "") return
        core("setMemberRole", [setCalId, id, root.setNewRole])
        setNewMember.text = ""; refresh()
    }
    function removeMember(id) { core("setMemberRole", [setCalId, id, "remove"]); refresh() }

    Popup {
        id: calSettingsPopup
        anchors.centerIn: Overlay.overlay
        width: 500; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small

            LogosText { text: "Calendar settings"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }

            // scrollable body — this popup can get tall
            Flickable {
                Layout.fillWidth: true
                Layout.preferredHeight: Math.min(contentHeight, 520)
                contentWidth: width; contentHeight: settingsBody.implicitHeight
                clip: true
                ScrollBar.vertical: ScrollBar {}
                ColumnLayout {
                    id: settingsBody
                    width: parent.width; spacing: Theme.spacing.small

                    LogosText { text: "Name"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: setName; Layout.fillWidth: true; placeholderText: "Calendar name" }

                    LogosText { text: "Description"; color: root.cFaint; font.pixelSize: 11 }
                    Field { id: setDesc; Layout.fillWidth: true; placeholderText: "Optional description" }

                    Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2; Layout.topMargin: 4 }

                    // ── signing identity (rebind) — which of MY identities signs my events here. The
                    // OWNER is fixed at creation; this only changes who I author as. Tapping a Keycard
                    // makes my future writes need a card tap.
                    LogosText { text: "Signs as"; color: root.cText; font.pixelSize: 14; font.weight: Theme.typography.weightMedium }
                    Flow {
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        Repeater {
                            model: root.identities
                            Rectangle {
                                radius: Theme.spacing.radiusSmall
                                color: (root.calSetIdentity === modelData.id) ? root.cBlue : root.cSurface
                                border.width: 1
                                border.color: (root.calSetIdentity === modelData.id) ? root.cBlue : root.cSurface2
                                implicitHeight: setIdChipT.implicitHeight + 10; implicitWidth: setIdChipT.implicitWidth + 22
                                LogosText { id: setIdChipT; anchors.centerIn: parent
                                    text: (modelData.kind === "keycard" ? "🔑 " : "") + modelData.label; font.pixelSize: 12; color: root.cText }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor
                                    onClicked: { root.loamCore("bindContainer", [root.setCalId, modelData.id]); root.calSetIdentity = modelData.id; root.refresh() } }
                            }
                        }
                    }
                    LogosText { text: "Changes who signs your future events on this calendar; the owner is unchanged."
                        color: root.cFaint; font.pixelSize: 10; wrapMode: Text.WordWrap; Layout.fillWidth: true }

                    Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2; Layout.topMargin: 4 }

                    // ── custom fields editor ──
                    LogosText { text: "Custom fields"; color: root.cText; font.pixelSize: 14; font.weight: Theme.typography.weightMedium }
                    LogosText {
                        visible: setSchemaModel.count === 0
                        text: "No custom fields yet. Add one below to collect extra info on each event."
                        color: root.cFaint; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }
                    Repeater {
                        model: setSchemaModel
                        delegate: Rectangle {
                            Layout.fillWidth: true; implicitHeight: 34; radius: Theme.spacing.radiusSmall; color: root.cMantle
                            RowLayout {
                                anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                                LogosText { text: (model.label || model.key); color: root.cText; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                                LogosText { text: model.ftype; color: root.cSub; font.pixelSize: 12 }
                                LogosText {
                                    text: "✕"; color: root.cFaint; font.pixelSize: 14
                                    MouseArea { anchors.fill: parent; anchors.margins: -4; onClicked: setSchemaModel.remove(index) }
                                }
                            }
                        }
                    }

                    // add-field row
                    RowLayout {
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        Field { id: setNewKey; Layout.fillWidth: true; placeholderText: "key" }
                        Field { id: setNewLabel; Layout.fillWidth: true; placeholderText: "label" }
                    }
                    Flow {
                        Layout.fillWidth: true; spacing: 6
                        Repeater {
                            model: root.fieldTypes
                            delegate: Rectangle {
                                height: 26; radius: 13; width: tLbl.width + 18
                                color: root.setNewType === modelData ? root.cSurface : root.cBase
                                border.width: 1; border.color: root.setNewType === modelData ? root.cBlue : root.cSurface2
                                LogosText { id: tLbl; anchors.centerIn: parent; text: modelData; color: root.cText; font.pixelSize: 12 }
                                MouseArea { anchors.fill: parent; onClicked: root.setNewType = modelData }
                            }
                        }
                    }
                    Field {
                        id: setNewOptions
                        visible: root.setNewType === "enum"
                        Layout.fillWidth: true; placeholderText: "enum options (comma-separated)"
                    }
                    LogosButton { text: "+ Add field"; enabled: setNewKey.text.trim().length > 0; onClicked: root.addSchemaField() }

                    Rectangle { Layout.fillWidth: true; height: 1; color: root.cSurface2; Layout.topMargin: 4 }

                    // ── sharing & roles ──
                    LogosText { text: "Sharing & roles"; color: root.cText; font.pixelSize: 14; font.weight: Theme.typography.weightMedium }
                    // Access tier (ADR 0019) — one 3-way choice (Closed→Open→Collaborative) instead of
                    // independent Open/Collaborative toggles, so the off-ladder "collaborative + closed"
                    // combo can't be produced. Same widget as the New-calendar dialog. Owner/editor only.
                    ColumnLayout {
                        visible: root.canManage(root.setCalId)
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        LogosText { text: "Access"; color: root.cFaint; font.pixelSize: 11 }
                        Repeater {
                            model: root.accessTiers
                            Rectangle {
                                Layout.fillWidth: true
                                radius: Theme.spacing.radiusSmall
                                color: (root.calTierOf(root.calById(root.setCalId)) === modelData.tier) ? root.cSurface : "transparent"
                                border.width: 1
                                border.color: (root.calTierOf(root.calById(root.setCalId)) === modelData.tier) ? root.cBlue : root.cSurface2
                                implicitHeight: setTierRow.implicitHeight + 2 * Theme.spacing.small
                                RowLayout {
                                    id: setTierRow
                                    anchors.left: parent.left; anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter
                                    anchors.margins: Theme.spacing.small; spacing: Theme.spacing.small
                                    Rectangle {
                                        Layout.alignment: Qt.AlignTop; width: 16; height: 16; radius: 8; color: "transparent"
                                        border.width: 2; border.color: (root.calTierOf(root.calById(root.setCalId)) === modelData.tier) ? root.cBlue : root.cSurface2
                                        Rectangle { anchors.centerIn: parent; width: 8; height: 8; radius: 4; color: root.cBlue; visible: root.calTierOf(root.calById(root.setCalId)) === modelData.tier }
                                    }
                                    ColumnLayout {
                                        Layout.fillWidth: true; spacing: 0
                                        LogosText { text: modelData.title; color: root.cText; font.pixelSize: 13 }
                                        LogosText { text: modelData.desc; color: root.cFaint; font.pixelSize: 11; Layout.fillWidth: true; wrapMode: Text.WordWrap }
                                    }
                                }
                                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: { root.core("updateCalendarMeta", [root.setCalId, JSON.stringify(root.calTierMeta(modelData.tier))]); root.refresh() } }
                            }
                        }
                    }
                    LogosText {
                        text: "Add someone by their identity (they'll find it in Diagnostics ⚙ → This device id). Editors can edit any event; viewers are read-only."
                        color: root.cFaint; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }

                    LogosText {
                        visible: { var c = root.calById(root.setCalId); return !!c && c.rolesConfigured === false }
                        text: "No members yet — anyone with the invite can add events (and edit their own). Add an editor to let someone edit everyone's; add a viewer for read-only."
                        color: root.cYellow; font.pixelSize: 11; wrapMode: Text.WordWrap; Layout.fillWidth: true
                    }

                    Repeater {
                        model: root.membersFor(root.setCalId)
                        delegate: Rectangle {
                            Layout.fillWidth: true; implicitHeight: 34; radius: Theme.spacing.radiusSmall; color: root.cMantle
                            RowLayout {
                                anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                                LogosText { text: root.shortAuthor(modelData.id); color: root.cText; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                                LogosText { text: modelData.role; color: root.cSub; font.pixelSize: 12 }
                                LogosText {
                                    visible: modelData.removable && root.canManage(root.setCalId)
                                    text: "✕"; color: root.cFaint; font.pixelSize: 14
                                    MouseArea { anchors.fill: parent; anchors.margins: -4; onClicked: root.removeMember(modelData.id) }
                                }
                            }
                        }
                    }

                    // add-member row (owner/admin only)
                    ColumnLayout {
                        visible: root.canManage(root.setCalId)
                        Layout.fillWidth: true; spacing: Theme.spacing.small
                        Field { id: setNewMember; Layout.fillWidth: true; placeholderText: "paste an identity to add" }
                        RowLayout {
                            Layout.fillWidth: true; spacing: 6
                            Repeater {
                                model: ["editor", "viewer"]
                                delegate: Rectangle {
                                    height: 26; radius: 13; width: rLbl.width + 18
                                    color: root.setNewRole === modelData ? root.cSurface : root.cBase
                                    border.width: 1; border.color: root.setNewRole === modelData ? root.cBlue : root.cSurface2
                                    LogosText { id: rLbl; anchors.centerIn: parent; text: modelData; color: root.cText; font.pixelSize: 12 }
                                    MouseArea { anchors.fill: parent; onClicked: root.setNewRole = modelData }
                                }
                            }
                            Item { Layout.fillWidth: true }
                            LogosButton { text: "Add member"; enabled: setNewMember.text.trim().length > 0; onClicked: root.addMember() }
                        }
                    }
                }
            }

            ListModel { id: setSchemaModel }

            LogosText {
                visible: root.setSaveError !== ""
                text: root.setSaveError
                color: root.cYellow; font.pixelSize: 12; wrapMode: Text.WordWrap
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: Theme.spacing.small
                LogosText { text: "iCalendar"; color: root.cFaint; font.pixelSize: 11; Layout.alignment: Qt.AlignVCenter }
                LogosButton { text: "Export .ics"; onClicked: { calSettingsPopup.close(); icsSaveDialog.open() } }
                LogosButton { text: "Import .ics"; onClicked: { calSettingsPopup.close(); icsOpenDialog.open() } }
                Item { Layout.fillWidth: true }
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small; spacing: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: calSettingsPopup.close() }
                LogosButton { text: "Save"; onClicked: root.saveCalSettings() }
            }
        }
    }

    // ── join popup ─────────────────────────────────────────────────────────
    Popup {
        id: joinPopup
        anchors.centerIn: Overlay.overlay
        width: 420; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        onOpened: { joinLink.text = ""; root.joinIdentity = "" }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: "Join a shared calendar"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }
            LogosText { text: "Paste the scala:// invite link"; color: root.cFaint; font.pixelSize: 12 }
            Field { id: joinLink; Layout.fillWidth: true; placeholderText: "scala://join?..." }
            // Author as — which identity signs YOUR events on this calendar (owner stays the inviter).
            LogosText { text: "Author as"; color: root.cFaint; font.pixelSize: 11; Layout.topMargin: Theme.spacing.small }
            Flow {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                Repeater {
                    model: root.identities
                    Rectangle {
                        radius: Theme.spacing.radiusSmall
                        color: (root.joinIdentity === modelData.id || (root.joinIdentity === "" && modelData.id === root.defaultIdentityId)) ? root.cBlue : root.cSurface
                        border.width: 1
                        border.color: (root.joinIdentity === modelData.id || (root.joinIdentity === "" && modelData.id === root.defaultIdentityId)) ? root.cBlue : root.cSurface2
                        implicitHeight: jChipT.implicitHeight + 10; implicitWidth: jChipT.implicitWidth + 22
                        LogosText { id: jChipT; anchors.centerIn: parent; text: modelData.label; font.pixelSize: 12; color: root.cText }
                        MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.joinIdentity = modelData.id }
                    }
                }
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: joinPopup.close() }
                LogosButton {
                    text: "Join"; enabled: joinLink.text.trim().length > 0
                    onClicked: { var ok = root.j(root.core("handleShareLink", [joinLink.text.trim(), (root.joinIdentity || root.defaultIdentityId)]), false); joinPopup.close(); root.refresh(); root.notify(ok ? "Calendar joined." : "Couldn't join — check the link.", !ok) }
                }
            }
        }
    }

    // ── share popup (link + a real QR the phone can scan) ─────────────────────
    property var qrData: null    // { n, cells } from core qrMatrix
    property var shareCal: null  // the calendar being shared (for "add snapshot")
    property int snapPolls: 0
    function b64url(s) { return Qt.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }
    function setShareQr(link) {
        shareLink.text = (typeof link === "string" ? link : "")
        root.qrData = null
        var m = root.j(core("qrMatrix", [shareLink.text]), null)
        if (m && m.ok && m.n && m.cells && m.cells.length >= m.n * m.n) root.qrData = { n: m.n, cells: m.cells }
        qrCanvas.requestPaint()
    }
    function openShare(cal) {
        root.shareCal = cal
        shareTitle.text = cal.name || "calendar"
        shareStatus.text = ""
        var link = root.j(core("generateShareLink", [cal.id]), "")
        root.setShareQr(link)
        sharePopup.open()
    }
    // ADR 0020: write a snapshot of this calendar, then rebuild the invite with &snap=<pointer>&stor=<codex spr>
    // so a joining phone bootstraps from Storage instead of a full-log sync. The CID arrives async → poll.
    function shareWithSnapshot() {
        if (!root.shareCal) return
        shareStatus.text = "Creating snapshot…"
        core("snapshotCalendar", [root.shareCal.id, "1000"])   // small epoch so just-seeded events are in a completed cut
        root.snapPolls = 0
        snapPollTimer.start()
    }
    Timer {
        id: snapPollTimer; interval: 1200; repeat: true
        onTriggered: {
            root.snapPolls++
            var p = root.j(core("getSnapshotPointer", [root.shareCal ? root.shareCal.id : ""]), null)
            if (p && p.cid) {
                stop()
                var spr = root.j(core("getStorageSpr", []), "")
                var base = root.j(core("generateShareLink", [root.shareCal.id]), "")
                var link = base + "&snap=" + root.b64url(JSON.stringify(p)) + (spr ? "&stor=" + root.b64url(spr) : "")
                shareStatus.text = "Snapshot ready — " + (p.count || 0) + " events" + (spr ? "" : " (no storage SPR!)")
                root.setShareQr(link)
            } else if (root.snapPolls > 12) {
                stop(); shareStatus.text = "Snapshot timed out (storage up?)"
            }
        }
    }
    Popup {
        id: sharePopup
        anchors.centerIn: Overlay.overlay
        width: 520; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        onOpened: qrCanvas.requestPaint()
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { id: shareTitle; text: ""; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }
            LogosText { text: "Scan this on the phone, or copy the link:"; color: root.cFaint; font.pixelSize: 12 }
            Rectangle {
                Layout.alignment: Qt.AlignHCenter
                width: 440; height: 440; radius: Theme.spacing.radiusSmall; color: "#ffffff"
                visible: root.qrData !== null
                Canvas {
                    id: qrCanvas; anchors.fill: parent; anchors.margins: 12
                    onPaint: {
                        var ctx = getContext("2d"); ctx.reset()
                        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height)
                        var d = root.qrData; if (!d || !d.n) return
                        var cell = width / d.n; ctx.fillStyle = "#000000"
                        for (var y = 0; y < d.n; y++)
                            for (var x = 0; x < d.n; x++)
                                if (d.cells[y * d.n + x])
                                    ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell))
                    }
                }
            }
            Field { id: shareLink; Layout.fillWidth: true; readOnly: true; selectByMouse: true }
            LogosText { id: shareStatus; text: ""; visible: text !== ""; color: root.cFaint; font.pixelSize: 12 }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                LogosButton { text: "＋ Snapshot"; onClicked: root.shareWithSnapshot() }
                Item { Layout.fillWidth: true }
                LogosButton { text: "Copy"; onClicked: { shareLink.selectAll(); shareLink.copy() } }
                LogosButton { text: "Close"; onClicked: sharePopup.close() }
            }
        }
    }

    // ── delete calendar (with confirm) ─────────────────────────────────────────
    property var pendingDeleteCal: null
    function confirmDeleteCalendar(cal) { pendingDeleteCal = cal; deletePopup.open() }
    function deleteCalendar() {
        if (!pendingDeleteCal) return
        var id = pendingDeleteCal.id
        core("deleteCalendar", [id])
        if (filterCalId === id) filterCalId = ""
        pendingDeleteCal = null
        deletePopup.close()
        refresh()
    }
    Popup {
        id: deletePopup
        anchors.centerIn: Overlay.overlay
        width: 380; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: "Delete calendar?"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }
            LogosText {
                text: "Remove \"" + (root.pendingDeleteCal ? (root.pendingDeleteCal.name || "calendar") : "") + "\" from this device. Its local events are deleted. Peers who joined keep their own copy."
                color: root.cFaint; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: { root.pendingDeleteCal = null; deletePopup.close() } }
                LogosButton { text: "Delete"; onClicked: root.deleteCalendar() }
            }
        }
    }
    // Confirm before deleting an event (destructive, and a recurring master takes the whole series).
    Popup {
        id: deleteEventPopup
        anchors.centerIn: Overlay.overlay
        width: 380; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: "Delete event?"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }
            LogosText {
                text: "Delete \"" + (root.editingEvent ? (root.editingEvent.title || "(untitled)") : "")
                    + "\"" + ((root.editingEvent && root.editingEvent.recur) ? " and its whole repeating series" : "")
                    + ". This can't be undone."
                color: root.cFaint; font.pixelSize: 12; wrapMode: Text.WordWrap; Layout.fillWidth: true
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton { text: "Cancel"; onClicked: deleteEventPopup.close() }
                LogosButton { text: "Delete"; onClicked: root.doDeleteEvent() }
            }
        }
    }

    // ── diagnostics popup (connection + events) ──────────────────────────────
    property var diag: null
    function openDiag() { root.diag = root.j(core("diagnostics", []), null); diagPopup.open() }
    Popup {
        id: diagPopup
        anchors.centerIn: Overlay.overlay
        width: 460; height: 460; modal: true; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        onOpened: root.diag = root.j(root.core("diagnostics", []), null)
        ColumnLayout {
            anchors.fill: parent; spacing: Theme.spacing.small
            LogosText { text: "Diagnostics"; color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium }

            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.medium
                Rectangle { width: 10; height: 10; radius: 5; color: (root.diag && root.diag.nodeReady) ? root.cGreen : root.cYellow; Layout.alignment: Qt.AlignVCenter }
                LogosText { text: (root.diag && root.diag.nodeReady) ? "Delivery node connected" : "Node not ready"; color: root.cText; font.pixelSize: 14 }
                Item { Layout.fillWidth: true }
                LogosButton { text: "Refresh"; onClicked: root.diag = root.j(root.core("diagnostics", []), null) }
            }
            LogosText {
                text: root.diag ? ("delivery: " + (root.diag.deliveryStatus || "(none)") + "   ·   context ready: " + (root.diag.ctxReady ? "yes" : "NO")) : "—"
                color: root.cSub; font.pixelSize: 12
            }
            LogosText {
                text: root.diag ? (root.diag.calendarCount + " calendar(s) · " + root.diag.eventCount + " event(s) total") : "—"
                color: root.cSub; font.pixelSize: 12
            }
            LogosText {
                text: root.diag ? ("data: " + (root.diag.dataDir || "?")) : ""
                color: root.cFaint; font.pixelSize: 11; elide: Text.ElideMiddle; Layout.fillWidth: true
            }
            LogosText { text: "Your identity (share this to be added to a calendar)"; color: root.cFaint; font.pixelSize: 11 }
            RowLayout {
                Layout.fillWidth: true; spacing: Theme.spacing.small
                Field { id: diagIdField; text: root.diag ? (root.diag.identity || root.myIdentity || "(none)") : root.myIdentity; Layout.fillWidth: true; readOnly: true; selectByMouse: true }
                LogosButton { text: "Copy"; onClicked: { diagIdField.selectAll(); diagIdField.copy() } }
            }

            LogosText { text: "Per-calendar sync"; color: root.cFaint; font.pixelSize: 11; Layout.topMargin: Theme.spacing.small }
            ListView {
                Layout.fillWidth: true; Layout.fillHeight: true; clip: true
                model: (root.diag && root.diag.calendars) ? root.diag.calendars : []
                spacing: 4
                delegate: Rectangle {
                    width: ListView.view.width; height: 40; radius: Theme.spacing.radiusSmall; color: root.cMantle
                    RowLayout {
                        anchors.fill: parent; anchors.leftMargin: Theme.spacing.small; anchors.rightMargin: Theme.spacing.small; spacing: Theme.spacing.small
                        Rectangle { width: 8; height: 8; radius: 4; color: modelData.syncing ? root.cGreen : root.cFaint }
                        LogosText { text: modelData.name || modelData.id; color: root.cText; font.pixelSize: 13; Layout.fillWidth: true; elide: Text.ElideRight }
                        LogosText { text: (modelData.events || 0) + " ev"; color: root.cFaint; font.pixelSize: 12 }
                        LogosText { text: modelData.shared ? (modelData.syncing ? "syncing" : "offline") : "local"; color: modelData.syncing ? root.cGreen : root.cFaint; font.pixelSize: 12 }
                    }
                }
            }
            RowLayout { Layout.fillWidth: true; Item { Layout.fillWidth: true } LogosButton { text: "Close"; onClicked: diagPopup.close() } }
        }
    }

    // ── Keycard overlay (scala ADR 0016) — shown while a card tap is pending, or on failure ──────
    Popup {
        id: keycardOverlay
        anchors.centerIn: Overlay.overlay
        width: 420; modal: true; closePolicy: Popup.NoAutoClose; padding: Theme.spacing.large
        background: Rectangle { radius: 12; color: root.cSurface; border.width: 1; border.color: root.cSurface2 }
        readonly property bool failed: root.kc && root.kc.phase === "failed"
        readonly property bool enrolling: root.kc && root.kc.purpose === "enroll"
        ColumnLayout {
            width: parent.width; spacing: Theme.spacing.medium
            LogosText {
                text: keycardOverlay.failed ? "⚠️  Keycard error"
                      : (keycardOverlay.enrolling ? "💳  Enrolling your Keycard" : "💳  Sign with your Keycard")
                color: root.cText; font.pixelSize: 18; font.weight: Theme.typography.weightMedium
            }
            // A tiny rotating arc while pending (no BusyIndicator dependency).
            Rectangle {
                visible: !keycardOverlay.failed
                Layout.alignment: Qt.AlignHCenter
                width: 34; height: 34; radius: 17; color: "transparent"
                border.width: 3; border.color: root.cBlue
                Rectangle { width: 8; height: 8; radius: 4; color: root.cSurface; anchors.top: parent.top; anchors.horizontalCenter: parent.horizontalCenter; anchors.topMargin: -1 }
                RotationAnimation on rotation { from: 0; to: 360; duration: 1000; loops: Animation.Infinite; running: keycardOverlay.visible && !keycardOverlay.failed }
            }
            LogosText {
                Layout.fillWidth: true; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter
                text: keycardOverlay.failed ? (root.kc.error || "The Keycard operation failed.")
                      : "Hold your Keycard to the reader and approve the request in the Keycard UI (enter your PIN there)."
                color: keycardOverlay.failed ? root.cRed : root.cFaint; font.pixelSize: 13
            }
            RowLayout {
                Layout.fillWidth: true; Layout.topMargin: Theme.spacing.small
                Item { Layout.fillWidth: true }
                LogosButton {
                    text: keycardOverlay.failed ? "Close" : "Cancel"
                    onClicked: { keycardOverlay.close(); if (root.kc && root.kc.ref) root.kcLastRef = root.kc.ref }
                }
            }
        }
    }
}
