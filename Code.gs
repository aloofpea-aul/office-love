/**
 * ============================================================================
 *  Office Love — ระบบเดินตรวจความปลอดภัยสำนักงาน กฟส.อ่าวลึก
 *  Backend : Google Apps Script Web App
 *  Frontend: https://aloofpea-aul.github.io/office-love/
 *  เฟส 1 + แกนของเฟส 2 (รอบอัตโนมัติ) + หน้าตั้งค่าจุดตรวจของแอดมิน
 * ============================================================================
 *
 *  ขั้นตอนติดตั้ง (ทำครั้งเดียว)
 *  1) สร้าง Google Sheet ใหม่ชื่อ OfficeLove_DB  → คัดลอก ID มาใส่ CFG.DB_SHEET_ID
 *  2) ใส่ CFG.PLATFORM_SHEET_ID = ID ของชีตแพลตฟอร์มที่มีแท็บ Admins / Members
 *  3) รันฟังก์ชัน  setupAll()   หนึ่งครั้งจาก Editor (จะสร้างแท็บ + ข้อมูลตั้งต้น + ตั้ง trigger)
 *  4) Deploy > New deployment > Web app
 *       Execute as        : Me
 *       Who has access    : Anyone
 *     คัดลอก URL ที่ได้ไปใส่ใน index.html และ admin.html (ตัวแปร API)
 * ============================================================================
 */

var CFG = {
  DB_SHEET_ID       : '16FDAI8YlOMXlRxTTB6iiy6_4yB48Chv3D3PJBNxRKH4',  // ชีต OfficeLove_DB
  PLATFORM_SHEET_ID : '',            // เว้นว่าง = ใช้แท็บ Admins/Members ในชีตเดียวกัน
                                     // ถ้าจะย้ายไปใช้ชีตล็อกอินกลางของแพลตฟอร์มทีหลัง ค่อยใส่ ID ตรงนี้
  APP_CODE          : 'OFFICELOVE',  // ค่าที่ต้องมีในคอลัมน์ Apps ของแพลตฟอร์ม
  DRIVE_ROOT        : 'OfficeLove',  // โฟลเดอร์เก็บรูปใน Drive
  TZ                : 'Asia/Bangkok',
  TOKEN_TTL_DAYS    : 30,
  DAY_START_HOUR    : 6,             // วันปฏิบัติงานเริ่ม 06:00
  LINE_SOFT_CAP     : 250,           // เกินนี้ส่งเฉพาะเรื่องด่วน
  LINE_HARD_CAP     : 290            // เกินนี้หยุดส่ง LINE
};

// ---------------------------------------------------------------------------
// โครงตาราง — setupAll() ใช้สร้างแท็บและหัวคอลัมน์
// ---------------------------------------------------------------------------
var SCHEMA = {
  Admins         : ['UserId','Name','Password','Role','Status','Apps','Phone','Note'],
  Members        : ['UserId','Name','Password','Role','Status','Apps','Phone','Position','Note'],
  Config         : ['key','value','note'],
  Checkpoints    : ['cpId','code','name','lat','lng','radiusM','orderNo','requirePhoto',
                    'photoHeading','headingTol','refPhotoFileId','photoHint','active','note'],
  ChecklistItems : ['itemId','cpId','label','type','required','orderNo','active'],
  RoundPlan      : ['planId','dayType','roundNo','schedTime','graceEarlyMin','graceLateMin','active'],
  Holidays       : ['date','name','kind'],
  PushSubs       : ['userId','endpoint','p256dh','auth','device','createdAt','active'],
  Shifts         : ['shiftId','workDate','guardUserId','guardName','checkInAt','checkInLat','checkInLng',
                    'checkOutAt','checkOutLat','checkOutLng','status','note'],
  Rounds         : ['roundId','workDate','dayType','roundNo','schedAt','openAt','closeAt',
                    'guardUserId','shiftId','status','startedAt','finishedAt','pointsDone','pointsTotal'],
  Checkins       : ['checkinId','roundId','cpId','userId','userName','ts','clientTs','lat','lng',
                    'accuracyM','distanceM','verifyResult','overrideReason','ua'],
  CheckinAnswers : ['checkinId','itemId','value','remark'],
  Incidents      : ['incId','ts','roundId','cpId','userId','userName','category','severity','title',
                    'detail','lat','lng','status','assignedTo','closedAt','closeNote'],
  Attachments    : ['attId','refType','refId','driveFileId','url','takenAt','lat','lng',
                    'heading','headingOk','phase'],
  Notifications  : ['notifId','ts','channel','target','recipients','type','refId','status'],
  AuditLog       : ['ts','userId','action','refType','refId','before','after']
};

// ===========================================================================
// จุดเข้า Web App
// ===========================================================================
function doGet(e)  { return _json(_route((e && e.parameter) || {})); }
function doPost(e) {
  var req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { req = (e && e.parameter) || {}; }
  return _json(_route(req));
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function _route(req) {
  var action = String(req.action || 'ping');
  try {
    switch (action) {
      // --- สาธารณะ ---
      case 'ping'            : return ok({ time: nowIso(), app: 'Office Love' });
      case 'login'           : return apiLogin(req);

      // --- ต้องล็อกอิน ---
      case 'bootstrap'       : return apiBootstrap(auth(req));
      case 'shiftIn'         : return apiShiftIn(auth(req), req);
      case 'shiftOut'        : return apiShiftOut(auth(req), req);
      case 'checkin'         : return apiCheckin(auth(req), req);
      case 'incident'        : return apiIncident(auth(req), req);
      case 'myHistory'       : return apiMyHistory(auth(req), req);

      // --- หัวหน้า / ผู้ดูแล ---
      case 'supervisorBoard' : return apiSupervisorBoard(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'incidentUpdate'  : return apiIncidentUpdate(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'checkinDetail'   : return apiCheckinDetail(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'trend'           : return apiTrend(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'incidentDetail'  : return apiIncidentDetail(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'monthlyReport'   : return apiMonthlyReport(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'exportCsv'       : return apiExportCsv(auth(req, ['SUPERVISOR','ADMIN']), req);

      // --- ผู้ดูแล ---
      case 'adminData'       : return apiAdminData(auth(req, ['ADMIN']));
      case 'saveCheckpoint'  : return apiSaveCheckpoint(auth(req, ['ADMIN']), req);
      case 'saveChecklist'   : return apiSaveChecklist(auth(req, ['ADMIN']), req);
      case 'saveRoundPlan'   : return apiSaveRoundPlan(auth(req, ['ADMIN']), req);
      case 'saveHoliday'     : return apiSaveHoliday(auth(req, ['ADMIN']), req);
      case 'saveConfig'      : return apiSaveConfig(auth(req, ['ADMIN']), req);
      case 'uploadRefPhoto'  : return apiUploadRefPhoto(auth(req, ['ADMIN']), req);
      case 'lockMonth'       : return apiLockMonth(auth(req, ['ADMIN']), req);
      case 'notifyTest'      : return apiNotifyTest(auth(req, ['ADMIN']), req);

      default: return err('ไม่รู้จักคำสั่ง: ' + action);
    }
  } catch (ex) {
    return err(ex && ex.message ? ex.message : String(ex));
  }
}

function ok(data)  { var o = { ok: true };  if (data) for (var k in data) o[k] = data[k]; return o; }
function err(msg)  { return { ok: false, error: String(msg) }; }

// ===========================================================================
// ชีต / ตาราง
// ===========================================================================
function db() {
  return CFG.DB_SHEET_ID ? SpreadsheetApp.openById(CFG.DB_SHEET_ID)
                         : SpreadsheetApp.getActiveSpreadsheet();
}

function sheetOf(name) {
  var ss = db(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (SCHEMA[name]) sh.getRange(1, 1, 1, SCHEMA[name].length).setValues([SCHEMA[name]]);
  }
  return sh;
}

/** อ่านทั้งแท็บเป็น array ของ object */
function readTable(name) {
  var sh = sheetOf(name), last = sh.getLastRow();
  if (last < 2) return [];
  var w = Math.max(sh.getLastColumn(), 1);
  var vals = sh.getRange(1, 1, last, w).getValues();
  var head = vals[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = {}, empty = true;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      row[head[c]] = vals[i][c];
      if (vals[i][c] !== '' && vals[i][c] !== null) empty = false;
    }
    if (!empty) { row._row = i + 1; out.push(row); }
  }
  return out;
}

function appendRow(name, obj) {
  var sh = sheetOf(name);
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  var row = head.map(function (h) { return (obj[h] === undefined || obj[h] === null) ? '' : obj[h]; });
  sh.appendRow(row);
  return obj;
}

function updateRow(name, rowIndex, obj) {
  var sh = sheetOf(name);
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
               .map(function (h) { return String(h).trim(); });
  var cur = sh.getRange(rowIndex, 1, 1, head.length).getValues()[0];
  for (var c = 0; c < head.length; c++) {
    if (head[c] && obj[head[c]] !== undefined) cur[c] = obj[head[c]];
  }
  sh.getRange(rowIndex, 1, 1, head.length).setValues([cur]);
}

function cfgGet(key, dflt) {
  var rows = readTable('Config');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key) === key) return rows[i].value;
  }
  return dflt;
}

function prop(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }

// ===========================================================================
// เครื่องมือทั่วไป
// ===========================================================================
function uid(n) {
  var s = Utilities.getUuid().replace(/-/g, '');
  return s.substring(0, n || 8);
}
function nowIso()      { return toIso(new Date()); }
function toIso(d)      { return Utilities.formatDate(d, CFG.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function fmt(d, p)     { return Utilities.formatDate(d, CFG.TZ, p); }
function parseIso(s)   { return (s instanceof Date) ? s : new Date(String(s)); }
function num(v, d)     { var n = parseFloat(v); return isNaN(n) ? (d === undefined ? 0 : d) : n; }
function bool(v)       { var s = String(v).trim().toUpperCase(); return s === 'TRUE' || s === '1' || s === 'YES' || s === 'ใช่'; }

/** ระยะทางระหว่างสองพิกัด หน่วยเมตร */
function haversine(la1, lo1, la2, lo2) {
  var R = 6371000, r = Math.PI / 180;
  var p1 = la1 * r, p2 = la2 * r;
  var dp = (la2 - la1) * r, dl = (lo2 - lo1) * r;
  var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
          Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** วันปฏิบัติงานของเวลาที่กำหนด (ตัดวันที่ 06:00) */
function workDateOf(d) {
  var x = new Date(d.getTime());
  if (parseInt(fmt(x, 'HH'), 10) < CFG.DAY_START_HOUR) x.setDate(x.getDate() - 1);
  return fmt(x, 'yyyy-MM-dd');
}

function dstr(v) { return (v instanceof Date) ? fmt(v, 'yyyy-MM-dd') : String(v).trim(); }

function isHoliday(dateStr) {
  var rows = readTable('Holidays');
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i].date;
    var s = (d instanceof Date) ? fmt(d, 'yyyy-MM-dd') : String(d).trim();
    if (s === dateStr) return true;
  }
  var dow = new Date(dateStr + 'T12:00:00').getDay();   // 0=อา 6=ส
  return dow === 0 || dow === 6;
}

function monthOf(workDate) { return String(workDate).substring(0, 7); }

function isLocked(month) { return String(cfgGet('LOCK_' + month, '')).toUpperCase() === 'TRUE'; }

/** เดือนที่ปิดแล้วห้ามเขียนทับ — ใช้เป็นหลักฐานประกอบการตรวจรับงานจ้าง */
function assertUnlocked(workDate) {
  var m = monthOf(workDate);
  if (isLocked(m)) throw new Error('เดือน ' + m + ' ปิดงวดแล้ว แก้ไขข้อมูลย้อนหลังไม่ได้');
}

/** รายชื่อผู้ที่มอบหมายงานได้ */
function staffList() {
  var out = [];
  ['Admins', 'Members'].forEach(function (tab) {
    readPlatform(tab).forEach(function (r) {
      var n = String(pick(r, ['Name','ชื่อ-สกุล','ชื่อ','FullName']) || '').trim();
      if (!n) return;
      var st = String(pick(r, ['Status','สถานะ'])).trim().toUpperCase();
      if (st && ['INACTIVE','DISABLED','ปิด','ระงับ','FALSE','0'].indexOf(st) >= 0) return;
      if (out.indexOf(n) < 0) out.push(n);
    });
  });
  return out;
}

function audit(userId, action, refType, refId, before, after) {
  appendRow('AuditLog', {
    ts: nowIso(), userId: userId || '', action: action, refType: refType || '', refId: refId || '',
    before: before ? JSON.stringify(before).substring(0, 4000) : '',
    after:  after  ? JSON.stringify(after).substring(0, 4000)  : ''
  });
}

// ===========================================================================
// ล็อกอิน — อ่านสิทธิ์จากชีตแพลตฟอร์ม (Admins / Members) แบบอ่านอย่างเดียว
// ===========================================================================
function secret() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('TOKEN_SECRET', s); }
  return s;
}

function signToken(payload) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  var sig  = Utilities.base64EncodeWebSafe(
               Utilities.computeHmacSha256Signature(body, secret()));
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token) return null;
  var parts = String(token).split('.');
  if (parts.length !== 2) return null;
  var expect = Utilities.base64EncodeWebSafe(
                 Utilities.computeHmacSha256Signature(parts[0], secret()));
  if (expect !== parts[1]) return null;
  var payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (e) { return null; }
  if (!payload.exp || new Date(payload.exp).getTime() < Date.now()) return null;
  return payload;
}

function auth(req, roles) {
  var u = verifyToken(req.token);
  if (!u) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (roles && roles.indexOf(u.role) < 0) throw new Error('ไม่มีสิทธิ์ใช้งานส่วนนี้');
  return u;
}

/** หาค่าในแถวจากชื่อคอลัมน์ที่เป็นไปได้หลายแบบ */
function pick(row, names) {
  for (var i = 0; i < names.length; i++) {
    for (var k in row) {
      if (String(k).trim().toLowerCase() === names[i].toLowerCase()) {
        if (row[k] !== '' && row[k] !== null) return row[k];
      }
    }
  }
  return '';
}

/** ชีตที่เก็บผู้ใช้ — ถ้าไม่ได้ตั้ง PLATFORM_SHEET_ID ให้ใช้ชีตฐานข้อมูลเดียวกัน */
function platformSS() {
  return CFG.PLATFORM_SHEET_ID ? SpreadsheetApp.openById(CFG.PLATFORM_SHEET_ID) : db();
}

function readPlatform(tab) {
  var ss = platformSS();
  if (!ss) return [];
  var sh = ss.getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
  var head = vals[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = {};
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vals[i][c];
    out.push(o);
  }
  return out;
}

function sha256Hex(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function passwordMatch(stored, given) {
  var s = String(stored || '').trim();
  var g = String(given  || '');
  if (!s) return false;
  if (/^[0-9a-f]{64}$/i.test(s)) return s.toLowerCase() === sha256Hex(g);   // เก็บเป็น sha256
  return s === g;                                                          // เก็บเป็นข้อความตรง
}

function apiLogin(req) {
  var user = String(req.username || '').trim();
  var pass = String(req.password || '');
  if (!user || !pass) return err('กรอกชื่อผู้ใช้และรหัสผ่าน');

  var found = null, role = '';
  var sets = [{ tab: 'Admins', role: 'ADMIN' }, { tab: 'Members', role: 'GUARD' }];

  for (var s = 0; s < sets.length && !found; s++) {
    var rows = readPlatform(sets[s].tab);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var uname = String(pick(r, ['Username','User','UserId','Phone','เบอร์โทร','รหัสผู้ใช้','Email','อีเมล'])).trim();
      if (!uname || uname !== user) continue;
      if (!passwordMatch(pick(r, ['Password','Pass','รหัสผ่าน']), pass)) continue;

      var status = String(pick(r, ['Status','สถานะ','Active'])).trim().toUpperCase();
      if (status && ['INACTIVE','DISABLED','ปิด','ระงับ','FALSE','0'].indexOf(status) >= 0)
        return err('บัญชีนี้ถูกระงับการใช้งาน');

      var apps = String(pick(r, ['Apps','App','สิทธิ์แอป'])).toUpperCase();
      if (apps && apps.indexOf(CFG.APP_CODE) < 0) return err('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้ Office Love');

      found = r; role = sets[s].role;
      var lvl = String(pick(r, ['Role','Level','ระดับ','ตำแหน่งในระบบ'])).trim().toUpperCase();
      if (lvl.indexOf('ADMIN') >= 0)                              role = 'ADMIN';
      else if (lvl.indexOf('SUPER') >= 0 || lvl.indexOf('หัวหน้า') >= 0) role = 'SUPERVISOR';
      else if (sets[s].tab === 'Admins')                          role = 'ADMIN';
      break;
    }
  }

  if (!found) return err('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  var exp = new Date(Date.now() + CFG.TOKEN_TTL_DAYS * 86400000);
  var me = {
    userId : String(pick(found, ['UserId','Username','Phone','เบอร์โทร','Email']) || user),
    name   : String(pick(found, ['Name','ชื่อ-สกุล','ชื่อ','FullName']) || user),
    role   : role,
    exp    : toIso(exp)
  };
  audit(me.userId, 'LOGIN', 'USER', me.userId);
  return ok({ token: signToken(me), user: { userId: me.userId, name: me.name, role: me.role } });
}

// ===========================================================================
// สร้างรอบเดินตรวจ
// ===========================================================================
/** สร้างรอบของวันปฏิบัติงานที่ระบุ (ไม่สร้างซ้ำ) */
function generateRounds(workDate) {
  var dayType = isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY';
  var plans = readTable('RoundPlan').filter(function (p) {
    return String(p.dayType) === dayType && bool(p.active);
  }).sort(function (a, b) { return num(a.roundNo) - num(b.roundNo); });

  var existing = {};
  readTable('Rounds').forEach(function (r) {
    if (dstr(r.workDate) === workDate) existing[String(r.roundNo)] = true;
  });

  var cpTotal = readTable('Checkpoints').filter(function (c) { return bool(c.active); }).length;
  var made = 0;

  plans.forEach(function (p) {
    if (existing[String(p.roundNo)]) return;
    var hh, mm;
    if (p.schedTime instanceof Date) { hh = p.schedTime.getHours(); mm = p.schedTime.getMinutes(); }
    else {
      var t = String(p.schedTime);
      if (t.indexOf('T') > 0) t = t.split('T')[1];
      hh = parseInt(t.split(':')[0], 10);
      mm = parseInt(t.split(':')[1] || '0', 10);
    }
    if (isNaN(hh)) return;
    if (isNaN(mm)) mm = 0;

    var base = new Date(workDate + 'T12:00:00');
    if (hh < CFG.DAY_START_HOUR) base.setDate(base.getDate() + 1);   // รอบดึกนับเป็นวันถัดไปตามปฏิทิน
    var sched = new Date(fmt(base, 'yyyy-MM-dd') + 'T' +
                         ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2) + ':00');

    var open  = new Date(sched.getTime() - num(p.graceEarlyMin, 15) * 60000);
    var close = new Date(sched.getTime() + num(p.graceLateMin, 60) * 60000);

    appendRow('Rounds', {
      roundId: uid(), workDate: workDate, dayType: dayType, roundNo: num(p.roundNo),
      schedAt: toIso(sched), openAt: toIso(open), closeAt: toIso(close),
      guardUserId: '', shiftId: '', status: 'PENDING',
      startedAt: '', finishedAt: '', pointsDone: 0, pointsTotal: cpTotal
    });
    made++;
  });
  return made;
}

/** trigger รายวัน 05:00 — สร้างรอบของวันนี้และวันพรุ่งนี้ */
function dailyGenerateRounds() {
  var today = fmt(new Date(), 'yyyy-MM-dd');
  var tmr   = fmt(new Date(Date.now() + 86400000), 'yyyy-MM-dd');
  generateRounds(today);
  generateRounds(tmr);
}

/** trigger ทุก 15 นาที — ปิดรอบที่เลยเวลา + เตือนก่อนถึงรอบ */
function tickRounds() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var now = new Date();
    var sh  = sheetOf('Rounds');
    var rows = readTable('Rounds');

    rows.forEach(function (r) {
      var st = String(r.status);
      if (st === 'COMPLETE' || st === 'MISSED' || st === 'PARTIAL') return;
      var close = parseIso(r.closeAt);
      if (close.getTime() < now.getTime()) {
        var next = (num(r.pointsDone) > 0) ? 'PARTIAL' : 'MISSED';
        updateRow('Rounds', r._row, { status: next, finishedAt: nowIso() });
        notifySupervisor('รอบ ' + r.roundNo + ' วันที่ ' + r.workDate + ' สถานะ ' +
                         (next === 'MISSED' ? 'ขาด' : 'ไม่ครบจุด'), next === 'MISSED' ? 'HIGH' : 'MED');
      }
    });
    SpreadsheetApp.flush();
    void sh;
  } finally { lock.releaseLock(); }
}

/**
 * เตือนก่อนถึงรอบ และเตือนซ้ำเมื่อเลยเวลามาแล้วยังไม่มีใครเริ่ม
 * ตั้งเป็น trigger ทุก 5 นาที — กันส่งซ้ำด้วยประวัติในแท็บ Notifications
 */
function remindRounds() {
  if (String(cfgGet('NOTIFY_CHANNEL', 'WEBEX')).toUpperCase() === 'OFF') return 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    var now    = new Date().getTime();
    var before = num(cfgGet('REMIND_BEFORE_MIN', 10), 10) * 60000;
    var lateAf = num(cfgGet('REMIND_LATE_MIN', 20), 20) * 60000;

    var already = {};
    readTable('Notifications').forEach(function (n) {
      var t = String(n.type);
      if (t === 'ROUND_REMIND' || t === 'ROUND_LATE') already[t + '|' + String(n.refId)] = true;
    });

    var sent = 0;
    readTable('Rounds').forEach(function (r) {
      if (String(r.status) !== 'PENDING' || r.startedAt) return;
      var id    = String(r.roundId);
      var sched = parseIso(r.schedAt);
      var close = parseIso(r.closeAt);
      if (close.getTime() < now) return;
      var no = num(r.roundNo), hhmm = fmt(sched, 'HH:mm');

      if (now >= sched.getTime() - before && now < sched.getTime() && !already['ROUND_REMIND|' + id]) {
        var mins = Math.max(1, Math.round((sched.getTime() - now) / 60000));
        if (notify('อีก ' + mins + ' นาที ถึงรอบที่ ' + no + ' (' + hhmm + ' น.) เตรียมออกเดินตรวจได้เลย',
                   'MED', 'ROUND_REMIND', id, 'GUARD')) sent++;
      } else if (now >= sched.getTime() + lateAf && !already['ROUND_LATE|' + id]) {
        var late = Math.round((now - sched.getTime()) / 60000);
        if (notify('⚠️ เลยเวลารอบที่ ' + no + ' (' + hhmm + ' น.) มาแล้ว ' + late +
                   ' นาที ยังไม่มีการเช็คอิน — ปิดรอบ ' + fmt(close, 'HH:mm') + ' น.',
                   'HIGH', 'ROUND_LATE', id, 'GUARD')) sent++;
      }
    });
    return sent;
  } finally { lock.releaseLock(); }
}

// ===========================================================================
// API — ฝั่ง รปภ.
// ===========================================================================
function apiBootstrap(me) {
  var workDate = workDateOf(new Date());
  if (!readTable('Rounds').some(function (r) { return dstr(r.workDate) === workDate; }))
    generateRounds(workDate);

  var cps = readTable('Checkpoints').filter(function (c) { return bool(c.active); })
    .sort(function (a, b) { return num(a.orderNo) - num(b.orderNo); })
    .map(function (c) {
      return {
        cpId: String(c.cpId), code: String(c.code), name: String(c.name),
        lat: num(c.lat), lng: num(c.lng), radiusM: num(c.radiusM, 25),
        orderNo: num(c.orderNo), requirePhoto: bool(c.requirePhoto),
        photoHeading: (c.photoHeading === '' ? null : num(c.photoHeading)),
        headingTol: num(c.headingTol, 45),
        refPhotoUrl: c.refPhotoFileId ? driveViewUrl(c.refPhotoFileId) : '',
        photoHint: String(c.photoHint || '')
      };
    });

  var items = readTable('ChecklistItems').filter(function (i) { return bool(i.active); })
    .sort(function (a, b) { return num(a.orderNo) - num(b.orderNo); })
    .map(function (i) {
      return { itemId: String(i.itemId), cpId: String(i.cpId || 'ALL'), label: String(i.label),
               type: String(i.type || 'OK_NG'), required: bool(i.required), orderNo: num(i.orderNo) };
    });

  var rounds = readTable('Rounds').filter(function (r) { return dstr(r.workDate) === workDate; })
    .sort(function (a, b) { return num(a.roundNo) - num(b.roundNo); })
    .map(function (r) {
      return { roundId: String(r.roundId), roundNo: num(r.roundNo), status: String(r.status),
               schedAt: String(r.schedAt), openAt: String(r.openAt), closeAt: String(r.closeAt),
               pointsDone: num(r.pointsDone), pointsTotal: num(r.pointsTotal),
               guardUserId: String(r.guardUserId || '') };
    });

  var doneMap = {};
  readTable('Checkins').forEach(function (c) {
    if (!doneMap[c.roundId]) doneMap[c.roundId] = [];
    doneMap[c.roundId].push(String(c.cpId));
  });

  var shift = null;
  readTable('Shifts').forEach(function (s) {
    if (String(s.guardUserId) === me.userId && dstr(s.workDate) === workDate && !s.checkOutAt)
      shift = { shiftId: String(s.shiftId), checkInAt: String(s.checkInAt) };
  });

  return ok({
    user: { userId: me.userId, name: me.name, role: me.role },
    workDate: workDate, dayType: isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY',
    serverTime: nowIso(), checkpoints: cps, checklist: items,
    remindBeforeMin: num(cfgGet('REMIND_BEFORE_MIN', 10), 10),
    rounds: rounds, done: doneMap, shift: shift,
    categories: String(cfgGet('INCIDENT_CATEGORIES',
      'บุคคลต้องสงสัย,ประตู/รั้วผิดปกติ,ไฟฟ้า/แสงสว่าง,น้ำรั่ว/ท่วม,ไฟไหม้/ควัน,ทรัพย์สินเสียหาย,สัตว์,อื่น ๆ')).split(',')
  });
}

function apiShiftIn(me, req) {
  var workDate = workDateOf(new Date());
  var rows = readTable('Shifts');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].guardUserId) === me.userId && String(rows[i].workDate) === workDate && !rows[i].checkOutAt)
      return ok({ shiftId: String(rows[i].shiftId), already: true });
  }
  var id = uid();
  appendRow('Shifts', {
    shiftId: id, workDate: workDate, guardUserId: me.userId, guardName: me.name,
    checkInAt: nowIso(), checkInLat: num(req.lat), checkInLng: num(req.lng),
    checkOutAt: '', checkOutLat: '', checkOutLng: '', status: 'OPEN', note: String(req.note || '')
  });
  audit(me.userId, 'SHIFT_IN', 'SHIFT', id);
  return ok({ shiftId: id });
}

function apiShiftOut(me, req) {
  var rows = readTable('Shifts');
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    if (String(s.guardUserId) === me.userId && !s.checkOutAt) {
      updateRow('Shifts', s._row, {
        checkOutAt: nowIso(), checkOutLat: num(req.lat), checkOutLng: num(req.lng), status: 'CLOSED'
      });
      audit(me.userId, 'SHIFT_OUT', 'SHIFT', String(s.shiftId));
      return ok({ shiftId: String(s.shiftId) });
    }
  }
  return err('ไม่พบเวรที่เปิดอยู่');
}

function apiCheckin(me, req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return err('ระบบกำลังบันทึกรายการอื่น ลองใหม่อีกครั้ง');
  try {
    var roundId = String(req.roundId || '');
    var cpId    = String(req.cpId || '');
    if (!roundId || !cpId) return err('ข้อมูลไม่ครบ');

    var rounds = readTable('Rounds'), round = null;
    for (var i = 0; i < rounds.length; i++) if (String(rounds[i].roundId) === roundId) round = rounds[i];
    if (!round) return err('ไม่พบรอบเดินตรวจนี้');
    assertUnlocked(dstr(round.workDate));

    // กันเช็คอินซ้ำจุดเดิมในรอบเดียวกัน
    var already = readTable('Checkins').some(function (c) {
      return String(c.roundId) === roundId && String(c.cpId) === cpId;
    });
    if (already) return err('จุดนี้เช็คอินในรอบนี้ไปแล้ว');

    var cp = null;
    readTable('Checkpoints').forEach(function (c) { if (String(c.cpId) === cpId) cp = c; });
    if (!cp) return err('ไม่พบจุดตรวจ');

    var lat = num(req.lat), lng = num(req.lng), acc = num(req.accuracyM, 999);
    var dist = (lat && lng) ? haversine(lat, lng, num(cp.lat), num(cp.lng)) : -1;
    var radius = num(cp.radiusM, 25);

    var verify = 'PASS';
    if (dist < 0)               verify = 'NO_GPS';
    else if (dist > radius)     verify = req.overrideReason ? 'OVERRIDE' : 'OUT_OF_RANGE';
    if (verify === 'OUT_OF_RANGE') return err('อยู่ห่างจุด ' + cp.name + ' ' + dist + ' ม. (รัศมี ' + radius + ' ม.)');
    if (verify === 'PASS' && acc > num(cfgGet('MAX_ACCURACY_M', 30), 30)) verify = 'WARN_ACCURACY';

    var checkinId = uid();
    appendRow('Checkins', {
      checkinId: checkinId, roundId: roundId, cpId: cpId, userId: me.userId, userName: me.name,
      ts: nowIso(), clientTs: String(req.clientTs || ''), lat: lat, lng: lng,
      accuracyM: acc, distanceM: dist, verifyResult: verify,
      overrideReason: String(req.overrideReason || ''), ua: String(req.ua || '').substring(0, 200)
    });

    (req.answers || []).forEach(function (a) {
      appendRow('CheckinAnswers', {
        checkinId: checkinId, itemId: String(a.itemId), value: String(a.value),
        remark: String(a.remark || '')
      });
    });

    var urls = [];
    (req.photos || []).forEach(function (p) {
      var saved = savePhoto(p.dataUrl, 'CHECKIN', checkinId, {
        lat: lat, lng: lng, heading: p.heading, headingOk: p.headingOk, phase: 'ตรวจ'
      });
      if (saved) urls.push(saved.url);
    });

    // อัปเดตสถานะรอบ
    var done = readTable('Checkins').filter(function (c) { return String(c.roundId) === roundId; }).length;
    var total = num(round.pointsTotal) || readTable('Checkpoints').filter(function (c) { return bool(c.active); }).length;
    var patch = { pointsDone: done, guardUserId: me.userId };
    if (String(round.status) === 'PENDING') { patch.status = 'IN_PROGRESS'; patch.startedAt = nowIso(); }
    if (done >= total) { patch.status = 'COMPLETE'; patch.finishedAt = nowIso(); }
    updateRow('Rounds', round._row, patch);

    return ok({ checkinId: checkinId, verify: verify, distanceM: dist,
                pointsDone: done, pointsTotal: total, photoUrls: urls });
  } finally { lock.releaseLock(); }
}

function apiIncident(me, req) {
  assertUnlocked(workDateOf(new Date()));
  var id = uid();
  appendRow('Incidents', {
    incId: id, ts: nowIso(), roundId: String(req.roundId || ''), cpId: String(req.cpId || ''),
    userId: me.userId, userName: me.name, category: String(req.category || 'อื่น ๆ'),
    severity: String(req.severity || 'MED'), title: String(req.title || ''),
    detail: String(req.detail || ''), lat: num(req.lat), lng: num(req.lng),
    status: 'NEW', assignedTo: '', closedAt: '', closeNote: ''
  });
  (req.photos || []).forEach(function (p) {
    savePhoto(p.dataUrl, 'INCIDENT', id, { lat: num(req.lat), lng: num(req.lng),
                                           heading: p.heading, headingOk: '', phase: 'ก่อนแก้ไข' });
  });
  audit(me.userId, 'INCIDENT_NEW', 'INCIDENT', id, null, { title: req.title });
  notifySupervisor('แจ้งเหตุ: ' + (req.title || req.category) + ' โดย ' + me.name,
                   String(req.severity) === 'HIGH' ? 'HIGH' : 'MED');
  return ok({ incId: id });
}

function apiMyHistory(me, req) {
  var limit = num(req.limit, 50);
  var rows = readTable('Checkins').filter(function (c) { return String(c.userId) === me.userId; });
  rows = rows.slice(Math.max(0, rows.length - limit));
  return ok({ items: rows.map(function (c) {
    return { ts: String(c.ts), cpId: String(c.cpId), verify: String(c.verifyResult), distanceM: num(c.distanceM) };
  }) });
}

// ===========================================================================
// API — หัวหน้า
// ===========================================================================
function apiSupervisorBoard(me, req) {
  var workDate = String(req.workDate || workDateOf(new Date()));

  var rounds = readTable('Rounds').filter(function (r) { return dstr(r.workDate) === workDate; })
    .sort(function (a, b) { return num(a.roundNo) - num(b.roundNo); });
  var ids = {};
  rounds.forEach(function (r) { ids[String(r.roundId)] = true; });

  var checkins = readTable('Checkins').filter(function (c) { return ids[String(c.roundId)]; });
  var cinIds = {};
  checkins.forEach(function (c) { cinIds[String(c.checkinId)] = true; });

  // นับรูปต่อการเช็คอิน + ธงทิศไม่ตรง
  var photoCount = {}, headingBad = {};
  readTable('Attachments').forEach(function (a) {
    if (String(a.refType) !== 'CHECKIN' || !cinIds[String(a.refId)]) return;
    var k = String(a.refId);
    photoCount[k] = (photoCount[k] || 0) + 1;
    if (String(a.headingOk).toUpperCase() === 'FALSE') headingBad[k] = true;
  });

  var cps = readTable('Checkpoints').filter(function (c) { return bool(c.active); })
    .sort(function (a, b) { return num(a.orderNo) - num(b.orderNo); })
    .map(function (c) {
      return { cpId: String(c.cpId), code: String(c.code), name: String(c.name),
               lat: num(c.lat), lng: num(c.lng), radiusM: num(c.radiusM, 25) };
    });

  var shifts = readTable('Shifts').filter(function (s) { return dstr(s.workDate) === workDate; })
    .map(function (s) {
      return { shiftId: String(s.shiftId), guardName: String(s.guardName || s.guardUserId),
               checkInAt: String(s.checkInAt), checkOutAt: String(s.checkOutAt || ''),
               status: String(s.status) };
    });

  var incidents = readTable('Incidents').map(function (i) {
    return { incId: String(i.incId), ts: String(i.ts), title: String(i.title),
             category: String(i.category), severity: String(i.severity), detail: String(i.detail || ''),
             status: String(i.status), userName: String(i.userName), cpId: String(i.cpId || ''),
             workDate: workDateOf(parseIso(i.ts)) };
  }).filter(function (i) {
    return i.workDate === workDate || ['NEW','ACK','IN_PROGRESS'].indexOf(i.status) >= 0;
  }).sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });

  return ok({
    user: { userId: me.userId, name: me.name, role: me.role },
    workDate: workDate,
    dayType: isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY',
    serverTime: nowIso(),
    checkpoints: cps,
    shifts: shifts,
    rounds: rounds.map(function (r) {
      return { roundId: String(r.roundId), roundNo: num(r.roundNo), status: String(r.status),
               schedAt: String(r.schedAt), openAt: String(r.openAt), closeAt: String(r.closeAt),
               startedAt: String(r.startedAt || ''), finishedAt: String(r.finishedAt || ''),
               pointsDone: num(r.pointsDone), pointsTotal: num(r.pointsTotal) };
    }),
    checkins: checkins.map(function (c) {
      return { checkinId: String(c.checkinId), roundId: String(c.roundId), cpId: String(c.cpId),
               ts: String(c.ts), userName: String(c.userName), verify: String(c.verifyResult),
               lat: num(c.lat), lng: num(c.lng),
               distanceM: num(c.distanceM), accuracyM: num(c.accuracyM),
               photos: photoCount[String(c.checkinId)] || 0,
               headingBad: !!headingBad[String(c.checkinId)],
               overrideReason: String(c.overrideReason || '') };
    }),
    incidents: incidents
  });
}

function apiCheckinDetail(me, req) {
  var id = String(req.checkinId || '');
  var cin = null;
  readTable('Checkins').forEach(function (c) { if (String(c.checkinId) === id) cin = c; });
  if (!cin) return err('ไม่พบรายการเช็คอิน');

  var labels = {};
  readTable('ChecklistItems').forEach(function (i) { labels[String(i.itemId)] = String(i.label); });

  var answers = readTable('CheckinAnswers').filter(function (a) { return String(a.checkinId) === id; })
    .map(function (a) {
      return { label: labels[String(a.itemId)] || String(a.itemId),
               value: String(a.value), remark: String(a.remark || '') };
    });

  var photos = readTable('Attachments')
    .filter(function (a) { return String(a.refType) === 'CHECKIN' && String(a.refId) === id; })
    .map(function (a) {
      return { url: String(a.url), heading: a.heading === '' ? null : num(a.heading),
               headingOk: String(a.headingOk), takenAt: String(a.takenAt) };
    });

  var cpName = '';
  readTable('Checkpoints').forEach(function (c) { if (String(c.cpId) === String(cin.cpId)) cpName = String(c.name); });

  return ok({
    checkin: {
      checkinId: id, cpName: cpName, userName: String(cin.userName), ts: String(cin.ts),
      clientTs: String(cin.clientTs || ''), lat: num(cin.lat), lng: num(cin.lng),
      accuracyM: num(cin.accuracyM), distanceM: num(cin.distanceM),
      verify: String(cin.verifyResult), overrideReason: String(cin.overrideReason || ''),
      ua: String(cin.ua || '')
    },
    answers: answers, photos: photos
  });
}

/** สรุปย้อนหลัง N วันปฏิบัติงาน */
function apiTrend(me, req) {
  var days = Math.min(num(req.days, 30), 90);
  var from = fmt(new Date(Date.now() - days * 86400000), 'yyyy-MM-dd');
  var byDate = {};

  readTable('Rounds').forEach(function (r) {
    var d = dstr(r.workDate);
    if (d < from) return;
    if (!byDate[d]) byDate[d] = { workDate: d, total: 0, complete: 0, partial: 0, missed: 0, onTime: 0, started: 0 };
    var b = byDate[d];
    b.total++;
    var st = String(r.status);
    if (st === 'COMPLETE') b.complete++;
    else if (st === 'PARTIAL') b.partial++;
    else if (st === 'MISSED') b.missed++;
    if (r.startedAt) {
      b.started++;
      var late = parseIso(r.startedAt).getTime() - parseIso(r.schedAt).getTime();
      if (late <= 15 * 60000) b.onTime++;
    }
  });

  var list = Object.keys(byDate).sort().map(function (k) { return byDate[k]; });
  return ok({ days: list });
}

function apiIncidentUpdate(me, req) {
  var rows = readTable('Incidents');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].incId) !== String(req.incId)) continue;
    assertUnlocked(workDateOf(parseIso(rows[i].ts)));

    var patch = { status: String(req.status || rows[i].status),
                  assignedTo: (req.assignedTo === undefined) ? String(rows[i].assignedTo || '') : String(req.assignedTo) };
    if (String(req.status) === 'CLOSED') { patch.closedAt = nowIso(); patch.closeNote = String(req.closeNote || ''); }

    (req.photos || []).forEach(function (p) {
      savePhoto(p.dataUrl, 'INCIDENT', String(req.incId), {
        lat: num(p.lat), lng: num(p.lng), heading: p.heading, headingOk: '', phase: 'หลังแก้ไข'
      });
    });

    updateRow('Incidents', rows[i]._row, patch);
    audit(me.userId, 'INCIDENT_UPDATE', 'INCIDENT', String(req.incId), cleanRow(rows[i]), patch);
    return ok({});
  }
  return err('ไม่พบรายการแจ้งเหตุ');
}

function apiIncidentDetail(me, req) {
  var id = String(req.incId || ''), inc = null;
  readTable('Incidents').forEach(function (i) { if (String(i.incId) === id) inc = i; });
  if (!inc) return err('ไม่พบรายการแจ้งเหตุ');

  var cpName = '';
  readTable('Checkpoints').forEach(function (c) { if (String(c.cpId) === String(inc.cpId)) cpName = String(c.name); });

  var photos = readTable('Attachments')
    .filter(function (a) { return String(a.refType) === 'INCIDENT' && String(a.refId) === id; })
    .map(function (a) { return { url: String(a.url), phase: String(a.phase || ''), takenAt: String(a.takenAt) }; });

  return ok({
    incident: {
      incId: id, ts: String(inc.ts), title: String(inc.title), detail: String(inc.detail || ''),
      category: String(inc.category), severity: String(inc.severity), status: String(inc.status),
      userName: String(inc.userName), cpName: cpName, lat: num(inc.lat), lng: num(inc.lng),
      assignedTo: String(inc.assignedTo || ''), closedAt: String(inc.closedAt || ''),
      closeNote: String(inc.closeNote || ''), locked: isLocked(monthOf(workDateOf(parseIso(inc.ts))))
    },
    photos: photos, staff: staffList()
  });
}

// ===========================================================================
// รายงานรายเดือน — ใช้ประกอบการตรวจรับงานจ้าง รปภ.
// ===========================================================================
function apiMonthlyReport(me, req) {
  var month = String(req.month || fmt(new Date(), 'yyyy-MM'));

  var rounds = readTable('Rounds').filter(function (r) { return monthOf(dstr(r.workDate)) === month; });
  var ids = {};
  rounds.forEach(function (r) { ids[String(r.roundId)] = true; });
  var checkins = readTable('Checkins').filter(function (c) { return ids[String(c.roundId)]; });

  var byDate = {}, byRound = {}, byGuard = {};
  function guard(g) {
    if (!byGuard[g]) byGuard[g] = { name: g, checkins: 0, flagged: 0, override: 0, shifts: 0, hours: 0 };
    return byGuard[g];
  }

  rounds.forEach(function (r) {
    var d = dstr(r.workDate), st = String(r.status), no = String(num(r.roundNo));
    if (!byDate[d]) byDate[d] = { workDate: d, dayType: String(r.dayType), total: 0, complete: 0,
                                  partial: 0, missed: 0, onTime: 0, started: 0, points: 0, pointsTotal: 0 };
    if (!byRound[no]) byRound[no] = { roundNo: num(r.roundNo), total: 0, complete: 0, partial: 0, missed: 0 };
    var b = byDate[d], q = byRound[no];
    b.total++; q.total++;
    b.points += num(r.pointsDone); b.pointsTotal += num(r.pointsTotal);
    if (st === 'COMPLETE')      { b.complete++; q.complete++; }
    else if (st === 'PARTIAL')  { b.partial++;  q.partial++;  }
    else if (st === 'MISSED')   { b.missed++;   q.missed++;   }
    if (r.startedAt) {
      b.started++;
      if (parseIso(r.startedAt).getTime() - parseIso(r.schedAt).getTime() <= 15 * 60000) b.onTime++;
    }
  });

  checkins.forEach(function (c) {
    var g = guard(String(c.userName || c.userId));
    g.checkins++;
    if (String(c.verifyResult) !== 'PASS') g.flagged++;
    if (c.overrideReason) g.override++;
  });

  readTable('Shifts').filter(function (s) { return monthOf(dstr(s.workDate)) === month; })
    .forEach(function (s) {
      var g = guard(String(s.guardName || s.guardUserId));
      g.shifts++;
      if (s.checkInAt && s.checkOutAt) {
        var h = (parseIso(s.checkOutAt).getTime() - parseIso(s.checkInAt).getTime()) / 3600000;
        if (h > 0 && h < 24) g.hours = Math.round((g.hours + h) * 10) / 10;
      }
    });

  var incidents = readTable('Incidents')
    .filter(function (i) { return monthOf(workDateOf(parseIso(i.ts))) === month; })
    .map(function (i) {
      return { incId: String(i.incId), ts: String(i.ts), title: String(i.title),
               category: String(i.category), severity: String(i.severity), status: String(i.status),
               userName: String(i.userName), assignedTo: String(i.assignedTo || ''),
               closedAt: String(i.closedAt || ''), closeNote: String(i.closeNote || '') };
    }).sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });

  var complete = rounds.filter(function (r) { return String(r.status) === 'COMPLETE'; }).length;
  var missed   = rounds.filter(function (r) { return String(r.status) === 'MISSED'; }).length;
  var partial  = rounds.filter(function (r) { return String(r.status) === 'PARTIAL'; }).length;
  var started  = rounds.filter(function (r) { return !!r.startedAt; });
  var onTime   = started.filter(function (r) {
    return parseIso(r.startedAt).getTime() - parseIso(r.schedAt).getTime() <= 15 * 60000; }).length;
  var pts      = rounds.reduce(function (a, r) { return a + num(r.pointsDone); }, 0);
  var ptsTotal = rounds.reduce(function (a, r) { return a + num(r.pointsTotal); }, 0);

  return ok({
    user: { userId: me.userId, name: me.name, role: me.role },
    month: month,
    locked: isLocked(month),
    generatedAt: nowIso(),
    generatedBy: me.name,
    summary: {
      rounds: rounds.length, complete: complete, partial: partial, missed: missed,
      started: started.length, onTime: onTime,
      pctComplete: rounds.length ? Math.round(complete / rounds.length * 1000) / 10 : 0,
      pctOnTime:   started.length ? Math.round(onTime / started.length * 1000) / 10 : 0,
      pctPoints:   ptsTotal ? Math.round(pts / ptsTotal * 1000) / 10 : 0,
      checkins: checkins.length, points: pts, pointsTotal: ptsTotal,
      incidents: incidents.length,
      incidentsOpen: incidents.filter(function (i) { return i.status !== 'CLOSED'; }).length,
      photos: readTable('Attachments').filter(function (a) {
        return String(a.takenAt).indexOf(month) === 0; }).length
    },
    byDate:  Object.keys(byDate).sort().map(function (k) { return byDate[k]; }),
    byRound: Object.keys(byRound).sort(function (a, b) { return num(a) - num(b); })
                   .map(function (k) { return byRound[k]; }),
    byGuard: Object.keys(byGuard).sort().map(function (k) { return byGuard[k]; }),
    incidents: incidents
  });
}

/** ดาวน์โหลดข้อมูลดิบรายเดือนเป็น CSV */
function apiExportCsv(me, req) {
  var month = String(req.month || fmt(new Date(), 'yyyy-MM'));
  var table = String(req.table || 'Rounds');
  if (['Rounds','Checkins','Incidents','Shifts'].indexOf(table) < 0) return err('ไม่รองรับตารางนี้');

  var rows = readTable(table);
  if (table === 'Rounds' || table === 'Shifts') {
    rows = rows.filter(function (r) { return monthOf(dstr(r.workDate)) === month; });
  } else if (table === 'Incidents') {
    rows = rows.filter(function (r) { return monthOf(workDateOf(parseIso(r.ts))) === month; });
  } else {
    var ids2 = {};
    readTable('Rounds').forEach(function (r) {
      if (monthOf(dstr(r.workDate)) === month) ids2[String(r.roundId)] = true; });
    rows = rows.filter(function (c) { return ids2[String(c.roundId)]; });
  }

  var head = SCHEMA[table];
  var esc = function (v) {
    var s = (v instanceof Date) ? toIso(v) : String(v === undefined || v === null ? '' : v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  var lines = [head.map(esc).join(',')];
  rows.forEach(function (r) { lines.push(head.map(function (h) { return esc(r[h]); }).join(',')); });
  return ok({ table: table, month: month, rows: rows.length, csv: lines.join('\r\n') });
}

/** ปิด/เปิดงวดเดือน — ปิดแล้วห้ามเขียนข้อมูลของเดือนนั้นอีก */
function apiLockMonth(me, req) {
  var month = String(req.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return err('รูปแบบเดือนต้องเป็น YYYY-MM');
  var lock = (String(req.lock) !== 'false' && req.lock !== false);
  apiSaveConfig(me, { key: 'LOCK_' + month, value: lock ? 'TRUE' : 'FALSE',
                      note: 'ปิดงวดเดือน ' + month + ' — ตั้งโดยระบบรายงาน' });
  audit(me.userId, lock ? 'MONTH_LOCK' : 'MONTH_UNLOCK', 'MONTH', month);
  return ok({ month: month, locked: lock });
}

// ===========================================================================
// API — ผู้ดูแล
// ===========================================================================
function apiAdminData(me) {
  return ok({
    user: { userId: me.userId, name: me.name, role: me.role },
    checkpoints: readTable('Checkpoints').map(cleanRow),
    checklist:   readTable('ChecklistItems').map(cleanRow),
    roundPlan:   readTable('RoundPlan').map(cleanRow),
    holidays:    readTable('Holidays').map(function (h) {
      return { date: (h.date instanceof Date) ? fmt(h.date, 'yyyy-MM-dd') : String(h.date),
               name: String(h.name), kind: String(h.kind) };
    }),
    config:      readTable('Config').map(cleanRow)
  });
}

function cleanRow(r) {
  var o = {};
  for (var k in r) if (k !== '_row') o[k] = (r[k] instanceof Date) ? toIso(r[k]) : r[k];
  o._row = r._row;
  return o;
}

function apiSaveCheckpoint(me, req) {
  var c = req.item || {};
  var rows = readTable('Checkpoints');
  var rec = {
    cpId: String(c.cpId || uid()), code: String(c.code || ''), name: String(c.name || ''),
    lat: num(c.lat), lng: num(c.lng), radiusM: num(c.radiusM, 25), orderNo: num(c.orderNo, 99),
    requirePhoto: bool(c.requirePhoto) ? 'TRUE' : 'FALSE',
    photoHeading: (c.photoHeading === '' || c.photoHeading === null || c.photoHeading === undefined)
                    ? '' : Math.round(num(c.photoHeading)),
    headingTol: num(c.headingTol, 45),
    refPhotoFileId: String(c.refPhotoFileId || ''), photoHint: String(c.photoHint || ''),
    active: bool(c.active) ? 'TRUE' : 'FALSE', note: String(c.note || '')
  };
  var found = null;
  rows.forEach(function (r) { if (String(r.cpId) === rec.cpId) found = r; });
  if (found) { updateRow('Checkpoints', found._row, rec); audit(me.userId, 'CP_UPDATE', 'CHECKPOINT', rec.cpId, cleanRow(found), rec); }
  else       { appendRow('Checkpoints', rec);              audit(me.userId, 'CP_CREATE', 'CHECKPOINT', rec.cpId, null, rec); }
  return ok({ item: rec, warnings: checkpointWarnings(rec) });
}

/** เตือนเมื่อจุดใหม่ใกล้จุดอื่นเกินไปจน GPS แยกไม่ออก */
function checkpointWarnings(rec) {
  var w = [];
  readTable('Checkpoints').forEach(function (c) {
    if (String(c.cpId) === rec.cpId || !bool(c.active)) return;
    var d = haversine(num(rec.lat), num(rec.lng), num(c.lat), num(c.lng));
    if (d < 15) w.push('ห่างจาก "' + c.name + '" เพียง ' + d + ' ม. — GPS อาจแยกสองจุดนี้ไม่ออก');
    else if (d < num(rec.radiusM, 25) + num(c.radiusM, 25))
      w.push('รัศมีซ้อนทับกับ "' + c.name + '" (ห่าง ' + d + ' ม.) ควรลดรัศมีลง');
  });
  return w;
}

function apiSaveChecklist(me, req) {
  var c = req.item || {};
  var rec = {
    itemId: String(c.itemId || uid()), cpId: String(c.cpId || 'ALL'), label: String(c.label || ''),
    type: String(c.type || 'OK_NG'), required: bool(c.required) ? 'TRUE' : 'FALSE',
    orderNo: num(c.orderNo, 99), active: bool(c.active) ? 'TRUE' : 'FALSE'
  };
  var found = null;
  readTable('ChecklistItems').forEach(function (r) { if (String(r.itemId) === rec.itemId) found = r; });
  if (found) updateRow('ChecklistItems', found._row, rec); else appendRow('ChecklistItems', rec);
  audit(me.userId, 'CHECKLIST_SAVE', 'ITEM', rec.itemId, null, rec);
  return ok({ item: rec });
}

function apiSaveRoundPlan(me, req) {
  var c = req.item || {};
  var rec = {
    planId: String(c.planId || uid()), dayType: String(c.dayType || 'WORKDAY'),
    roundNo: num(c.roundNo, 1), schedTime: String(c.schedTime || '18:00'),
    graceEarlyMin: num(c.graceEarlyMin, 15), graceLateMin: num(c.graceLateMin, 60),
    active: bool(c.active) ? 'TRUE' : 'FALSE'
  };
  var found = null;
  readTable('RoundPlan').forEach(function (r) { if (String(r.planId) === rec.planId) found = r; });
  if (found) updateRow('RoundPlan', found._row, rec); else appendRow('RoundPlan', rec);
  audit(me.userId, 'ROUNDPLAN_SAVE', 'PLAN', rec.planId, null, rec);
  return ok({ item: rec });
}

function apiSaveHoliday(me, req) {
  var d = String((req.item || {}).date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return err('รูปแบบวันที่ต้องเป็น YYYY-MM-DD');
  var found = null;
  readTable('Holidays').forEach(function (r) {
    var s = (r.date instanceof Date) ? fmt(r.date, 'yyyy-MM-dd') : String(r.date).trim();
    if (s === d) found = r;
  });
  var rec = { date: d, name: String(req.item.name || ''), kind: String(req.item.kind || 'ราชการ') };
  if (req.remove) {
    if (found) sheetOf('Holidays').deleteRow(found._row);
    return ok({ removed: true });
  }
  if (found) updateRow('Holidays', found._row, rec); else appendRow('Holidays', rec);
  return ok({ item: rec });
}

function apiSaveConfig(me, req) {
  var found = null;
  readTable('Config').forEach(function (r) { if (String(r.key) === String(req.key)) found = r; });
  if (found) updateRow('Config', found._row, { value: req.value });
  else appendRow('Config', { key: String(req.key), value: req.value, note: String(req.note || '') });
  audit(me.userId, 'CONFIG_SAVE', 'CONFIG', String(req.key), null, { value: req.value });
  return ok({});
}

function apiUploadRefPhoto(me, req) {
  var saved = savePhoto(req.dataUrl, 'CHECKPOINT_REF', String(req.cpId || ''), {
    lat: num(req.lat), lng: num(req.lng), heading: req.heading, headingOk: 'TRUE', phase: 'ตัวอย่าง'
  });
  if (!saved) return err('อัปโหลดรูปไม่สำเร็จ');
  return ok({ fileId: saved.fileId, url: saved.url });
}

// ===========================================================================
// รูปภาพ
// ===========================================================================
function driveFolder() {
  var d = new Date();
  var path = [CFG.DRIVE_ROOT, fmt(d, 'yyyy'), fmt(d, 'MM'), fmt(d, 'dd')];
  var parent = DriveApp.getRootFolder();
  for (var i = 0; i < path.length; i++) {
    var it = parent.getFoldersByName(path[i]);
    parent = it.hasNext() ? it.next() : parent.createFolder(path[i]);
  }
  return parent;
}

function driveViewUrl(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1000';
}

function savePhoto(dataUrl, refType, refId, meta) {
  if (!dataUrl || String(dataUrl).indexOf('base64,') < 0) return null;
  var parts = String(dataUrl).split('base64,');
  var mime  = (parts[0].match(/data:([^;]+);/) || [null, 'image/jpeg'])[1];
  var blob  = Utilities.newBlob(Utilities.base64Decode(parts[1]), mime,
                                refType + '_' + refId + '_' + fmt(new Date(), 'HHmmss') + '.jpg');
  var file  = driveFolder().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  var att = {
    attId: uid(), refType: refType, refId: refId, driveFileId: file.getId(),
    url: driveViewUrl(file.getId()), takenAt: nowIso(),
    lat: meta.lat || '', lng: meta.lng || '',
    heading: (meta.heading === undefined || meta.heading === null || meta.heading === '') ? '' : Math.round(num(meta.heading)),
    headingOk: meta.headingOk === undefined ? '' : String(meta.headingOk),
    phase: meta.phase || ''
  };
  appendRow('Attachments', att);
  return { fileId: file.getId(), url: att.url };
}

// ===========================================================================
// แจ้งเตือน LINE — มีตัวกันโควตา
// ===========================================================================
function lineCountThisMonth() {
  var ym = fmt(new Date(), 'yyyy-MM');
  return readTable('Notifications').filter(function (n) {
    return String(n.channel) === 'LINE' && String(n.ts).indexOf(ym) === 0;
  }).reduce(function (s, n) { return s + num(n.recipients, 1); }, 0);
}

/**
 * ส่ง LINE พร้อมตรวจโควตา
 * severity: 'HIGH' ส่งเสมอจนถึง HARD_CAP · 'MED'/'LOW' หยุดที่ SOFT_CAP
 */
function sendLine(target, text, severity, type, refId, recipients) {
  var token = prop('LINE_TOKEN');
  if (!token || !target) return false;
  var used = lineCountThisMonth();
  var n = num(recipients, 1);
  var cap = (severity === 'HIGH') ? CFG.LINE_HARD_CAP : CFG.LINE_SOFT_CAP;
  if (used + n > cap) {
    appendRow('Notifications', { notifId: uid(), ts: nowIso(), channel: 'LINE', target: target,
      recipients: 0, type: type || '', refId: refId || '', status: 'SKIPPED_QUOTA' });
    return false;
  }
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: target, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
    appendRow('Notifications', { notifId: uid(), ts: nowIso(), channel: 'LINE', target: target,
      recipients: n, type: type || '', refId: refId || '', status: 'SENT' });
    return true;
  } catch (e) {
    appendRow('Notifications', { notifId: uid(), ts: nowIso(), channel: 'LINE', target: target,
      recipients: 0, type: type || '', refId: refId || '', status: 'ERROR' });
    return false;
  }
}

/**
 * ส่งข้อความผ่านบอต Webex — ฟรี ไม่มีโควตารายเดือนแบบ LINE
 * target เป็น roomId ของสเปซ หรืออีเมลของผู้รับก็ได้
 */
function sendWebex(target, text, type, refId) {
  var token = prop('WEBEX_TOKEN');
  if (!token || !target) return false;
  var t = String(target).trim();
  var payload = { markdown: text };
  if (t.indexOf('@') > 0) payload.toPersonEmail = t; else payload.roomId = t;
  try {
    var res = UrlFetchApp.fetch('https://webexapis.com/v1/messages', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var st = (code >= 200 && code < 300) ? 'SENT' : (code === 429 ? 'RATE_LIMITED' : 'ERROR ' + code);
    appendRow('Notifications', { notifId: uid(), ts: nowIso(), channel: 'WEBEX', target: t,
      recipients: (st === 'SENT' ? 1 : 0), type: type || '', refId: refId || '', status: st });
    return st === 'SENT';
  } catch (e) {
    appendRow('Notifications', { notifId: uid(), ts: nowIso(), channel: 'WEBEX', target: t,
      recipients: 0, type: type || '', refId: refId || '', status: 'ERROR' });
    return false;
  }
}

/** ปลายทาง Webex ของกลุ่มผู้รับ — สเปซก่อน แล้วตามด้วยอีเมลรายคน */
function webexTargets(audience) {
  var sup  = (audience === 'SUPERVISOR');
  var room = String(cfgGet(sup ? 'WEBEX_SUPERVISOR_ROOM' : 'WEBEX_GUARD_ROOM', '')).trim();
  if (!room) room = String(cfgGet('WEBEX_GUARD_ROOM', '')).trim();
  var mails = String(cfgGet(sup ? 'WEBEX_SUPERVISOR_EMAILS' : 'WEBEX_GUARD_EMAILS', ''))
    .split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
  return (room ? [room] : []).concat(mails);
}

/**
 * ศูนย์กลางการแจ้งเตือน — เลือกช่องทางจากค่าระบบ NOTIFY_CHANNEL
 * WEBEX (ค่าตั้งต้น) · LINE · BOTH · OFF
 * audience: 'GUARD' (รปภ.) หรือ 'SUPERVISOR' (หัวหน้าเวร)
 */
function notify(text, severity, type, refId, audience) {
  var ch = String(cfgGet('NOTIFY_CHANNEL', 'WEBEX')).toUpperCase();
  if (ch === 'OFF') return false;
  var sup = (audience === 'SUPERVISOR');
  var sent = false;

  if (ch === 'WEBEX' || ch === 'BOTH') {
    webexTargets(audience).forEach(function (t) {
      if (sendWebex(t, '**Office Love** — ' + text, type, refId)) sent = true;
    });
  }
  if (ch === 'LINE' || ch === 'BOTH') {
    var target = String(cfgGet(sup ? 'LINE_SUPERVISOR_TARGET' : 'LINE_GUARD_TARGET', ''));
    if (!target) target = String(cfgGet('LINE_SUPERVISOR_TARGET', ''));
    var count = num(cfgGet(sup ? 'LINE_SUPERVISOR_MEMBERS' : 'LINE_GUARD_MEMBERS', 1), 1);
    if (target && sendLine(target, '[Office Love] ' + text, severity || 'MED', type || '', refId || '', count))
      sent = true;
  }
  return sent;
}

function notifySupervisor(text, severity) {
  return notify(text, severity || 'MED', 'SUPERVISOR', '', 'SUPERVISOR');
}

/** ปุ่มทดสอบส่งแจ้งเตือนจากหน้าแอดมิน */
function apiNotifyTest(me, req) {
  var aud = (String(req.audience || 'GUARD').toUpperCase() === 'SUPERVISOR') ? 'SUPERVISOR' : 'GUARD';
  var ch  = String(cfgGet('NOTIFY_CHANNEL', 'WEBEX')).toUpperCase();
  var tg  = webexTargets(aud);
  var sent = notify(String(req.text || 'ทดสอบการแจ้งเตือน — ข้อความนี้ส่งจากระบบ Office Love'),
                    'MED', 'TEST', '', aud);
  audit(me.userId, 'NOTIFY_TEST', 'NOTIFY', aud, null, { channel: ch, sent: sent });
  if (!sent) {
    if (ch === 'OFF') return err('ค่าระบบ NOTIFY_CHANNEL ตั้งเป็น OFF อยู่');
    if ((ch === 'WEBEX' || ch === 'BOTH') && !tg.length)
      return err('ยังไม่ได้ตั้ง WEBEX_GUARD_ROOM หรือ WEBEX_GUARD_EMAILS');
    if ((ch === 'WEBEX' || ch === 'BOTH') && !prop('WEBEX_TOKEN'))
      return err('ยังไม่ได้ใส่โทเคนบอต Webex — รัน setWebexToken() ใน Apps Script หนึ่งครั้ง');
    return err('ส่งไม่สำเร็จ — ดูรายละเอียดในแท็บ Notifications');
  }
  return ok({ channel: ch, audience: aud, webexTargets: tg.length });
}

// ===========================================================================
// ติดตั้งครั้งแรก
// ===========================================================================
function setupAll() {
  setupSheets();
  seedUsers();
  seedConfig();
  upgradeConfig();
  seedRoundPlan();
  seedCheckpoints();
  seedChecklist();
  setupTriggers();
  dailyGenerateRounds();
  SpreadsheetApp.flush();
  Logger.log('ติดตั้งเรียบร้อย — อย่าลืมแก้พิกัดจุดตรวจให้ตรงกับของจริงในหน้าแอดมิน');
}

function setupSheets() {
  for (var name in SCHEMA) {
    var sh = sheetOf(name);
    var head = SCHEMA[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  }
}

/** ผู้ใช้ตั้งต้น — เปลี่ยนรหัสผ่านทันทีหลังเข้าระบบครั้งแรก */
function seedUsers() {
  if (!readPlatform('Admins').length) {
    appendRow('Admins', { UserId: 'admin', Name: 'ผู้ดูแลระบบ', Password: 'admin1234',
      Role: 'ADMIN', Status: 'Activated', Apps: 'OFFICELOVE', Phone: '',
      Note: 'บัญชีตั้งต้น — เปลี่ยนรหัสผ่านทันที' });
  }
  if (!readPlatform('Members').length) {
    appendRow('Members', { UserId: 'guard01', Name: 'ชื่อ-สกุล รปภ.', Password: 'guard1234',
      Role: 'GUARD', Status: 'Activated', Apps: 'OFFICELOVE', Phone: '',
      Position: 'พนักงานรักษาความปลอดภัย', Note: 'แถวตัวอย่าง — แก้เป็นคนจริงแล้วเพิ่มแถวตามจำนวน รปภ.' });
    appendRow('Members', { UserId: 'chief01', Name: 'ชื่อ-สกุล หัวหน้าเวร', Password: 'chief1234',
      Role: 'SUPERVISOR', Status: 'Activated', Apps: 'OFFICELOVE', Phone: '',
      Position: 'หัวหน้าเวร', Note: 'แถวตัวอย่าง' });
  }
}

var CONFIG_DEFAULTS = [
  ['MAX_ACCURACY_M', 30, 'ความคลาดเคลื่อน GPS สูงสุดที่ถือว่าเชื่อถือได้ (เมตร)'],
  ['MIN_SECONDS_BETWEEN_POINTS', 20, 'เช็คอินสองจุดห่างกันน้อยกว่านี้ถือว่าผิดปกติ'],
  ['MAX_WALK_SPEED_MPS', 5, 'ความเร็วระหว่างจุดที่ถือว่าผิดมนุษย์ (เมตร/วินาที)'],

  ['NOTIFY_CHANNEL', 'WEBEX', 'ช่องทางแจ้งเตือน: WEBEX (ฟรี ไม่จำกัด) · LINE · BOTH · OFF'],
  ['WEBEX_GUARD_ROOM', '', 'roomId ของสเปซ Webex ที่ รปภ. อยู่ (เตือนก่อนถึงรอบ)'],
  ['WEBEX_GUARD_EMAILS', '', 'อีเมล Webex ของ รปภ. รายคน คั่นด้วยจุลภาค (ใช้แทนหรือเสริมสเปซ)'],
  ['WEBEX_SUPERVISOR_ROOM', '', 'roomId ของสเปซหัวหน้าเวร (ว่างไว้ = ใช้สเปซเดียวกับ รปภ.)'],
  ['WEBEX_SUPERVISOR_EMAILS', '', 'อีเมล Webex ของหัวหน้าเวร คั่นด้วยจุลภาค'],
  ['REMIND_BEFORE_MIN', 10, 'เตือนล่วงหน้ากี่นาทีก่อนถึงเวลารอบ'],
  ['REMIND_LATE_MIN', 20, 'เลยเวลารอบกี่นาทีแล้วยังไม่เริ่ม ให้เตือนซ้ำ'],

  ['LINE_SUPERVISOR_TARGET', '', 'userId หรือ groupId ของหัวหน้าเวร (เฉพาะช่องทาง LINE)'],
  ['LINE_SUPERVISOR_MEMBERS', 1, 'จำนวนคนในกลุ่มนั้น (ใช้คำนวณโควตา LINE)'],
  ['LINE_GUARD_TARGET', '', 'userId หรือ groupId ของ รปภ. (เฉพาะช่องทาง LINE)'],
  ['LINE_GUARD_MEMBERS', 1, 'จำนวนคนในกลุ่ม รปภ. (ใช้คำนวณโควตา LINE)'],

  ['INCIDENT_CATEGORIES', 'บุคคลต้องสงสัย,ประตู/รั้วผิดปกติ,ไฟฟ้า/แสงสว่าง,น้ำรั่ว/ท่วม,ไฟไหม้/ควัน,ทรัพย์สินเสียหาย,สัตว์,อื่น ๆ', 'หมวดแจ้งเหตุ']
];

function seedConfig() {
  if (readTable('Config').length) return;
  CONFIG_DEFAULTS.forEach(function (r) { appendRow('Config', { key: r[0], value: r[1], note: r[2] }); });
}

/** เพิ่มค่าระบบใหม่ให้ชีตที่ติดตั้งไปแล้ว — รันซ้ำได้ ไม่ทับค่าเดิม */
function upgradeConfig() {
  var have = {};
  readTable('Config').forEach(function (c) { have[String(c.key)] = true; });
  var added = 0;
  CONFIG_DEFAULTS.forEach(function (r) {
    if (have[r[0]]) return;
    appendRow('Config', { key: r[0], value: r[1], note: r[2] });
    added++;
  });
  return added;
}

function seedRoundPlan() {
  if (readTable('RoundPlan').length) return;
  var work = ['18:00','20:00','22:00','00:00','02:00','04:00'];
  work.forEach(function (t, i) {
    appendRow('RoundPlan', { planId: uid(), dayType: 'WORKDAY', roundNo: i + 1, schedTime: t,
                             graceEarlyMin: 15, graceLateMin: 60, active: 'TRUE' });
  });
  var holi = ['06:00','09:00','12:00','15:00','18:00','20:00','22:00','00:00','02:00','04:00'];
  holi.forEach(function (t, i) {
    appendRow('RoundPlan', { planId: uid(), dayType: 'HOLIDAY', roundNo: i + 1, schedTime: t,
                             graceEarlyMin: 15, graceLateMin: 60, active: 'TRUE' });
  });
}

/** จุดตรวจตั้งต้นจากระบบเดิม — พิกัดเป็นค่าชั่วคราว ต้องเดินเก็บจริงแล้วแก้ในหน้าแอดมิน */
function seedCheckpoints() {
  if (readTable('Checkpoints').length) return;
  var base = { lat: 8.365087, lng: 98.749451 };
  [['A','ประตูเข้าออก', true,  'ถ่ายให้เห็นบานประตูและกลอนล็อก'],
   ['B','ประตูเข้าอาคารสำนักงาน / โรงจอดรถ กฟภ.', false, ''],
   ['C','ภายในอาคารสำนักงาน ชั้น 1 และชั้น 2',     false, ''],
   ['D','คลังพัสดุ / ลานจอดรถเครน',                true,  'ถ่ายให้เห็นประตูคลังพัสดุและแม่กุญแจ'],
   ['E','ลานพัสดุกลางแจ้ง',                        true,  'ถ่ายให้เห็นกองพัสดุทั้งแถวและรั้ว'],
   ['F','โรงจอดรถพนักงาน / หน้าบ้านพักพนักงาน',    false, '']
  ].forEach(function (r, i) {
    appendRow('Checkpoints', {
      cpId: uid(), code: r[0], name: r[1],
      lat: base.lat, lng: base.lng,          // << ต้องแก้ให้ตรงจุดจริง
      radiusM: 25, orderNo: i + 1,
      requirePhoto: r[2] ? 'TRUE' : 'FALSE',
      photoHeading: '', headingTol: 45, refPhotoFileId: '', photoHint: r[3],
      active: 'TRUE', note: 'พิกัดชั่วคราว ต้องเดินเก็บจริงแล้วแก้ในหน้าแอดมิน'
    });
  });
}

function seedChecklist() {
  if (readTable('ChecklistItems').length) return;
  [['ประตู / รั้ว / กลอนล็อก'],
   ['แสงสว่างและเครื่องใช้ไฟฟ้า'],
   ['ความเรียบร้อยทั่วไปของพื้นที่']
  ].forEach(function (r, i) {
    appendRow('ChecklistItems', { itemId: uid(), cpId: 'ALL', label: r[0], type: 'OK_NG',
                                  required: 'TRUE', orderNo: i + 1, active: 'TRUE' });
  });
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'dailyGenerateRounds' || f === 'tickRounds' || f === 'remindRounds')
      ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyGenerateRounds').timeBased().atHour(5).everyDays(1)
           .inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('tickRounds').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('remindRounds').timeBased().everyMinutes(5).create();
}

/** ซ่อมข้อมูลที่ Sheets แปลงชนิดไปแล้ว แล้วสร้างรอบใหม่ */
function fixAndRebuild() {
  setupSheets();
  var rp = sheetOf('RoundPlan');
  if (rp.getLastRow() > 1) {
    var vals = rp.getRange(2, 4, rp.getLastRow() - 1, 1).getValues();
    var out = vals.map(function (v) {
      var x = v[0];
      return [(x instanceof Date) ? Utilities.formatDate(x, CFG.TZ, 'HH:mm') : String(x)];
    });
    rp.getRange(2, 4, out.length, 1).setNumberFormat('@').setValues(out);
  }
  var sh = sheetOf('Rounds');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  dailyGenerateRounds();
  SpreadsheetApp.flush();
  Logger.log('ซ่อมเรียบร้อย — สร้างรอบใหม่แล้ว');
}

/** ใส่โทเคน LINE (รันจาก Editor ครั้งเดียว อย่าเก็บโทเคนไว้ในโค้ด) */
function setLineToken() {
  PropertiesService.getScriptProperties().setProperty('LINE_TOKEN', 'ใส่ channel access token ที่นี่');
}

/**
 * เปิด/ปิดการแจ้งเตือนอย่างรวดเร็ว — เลือกฟังก์ชันแล้วกด Run ใน Editor
 * (แก้ที่หน้าแอดมิน แท็บค่าระบบ ก็ได้ผลเหมือนกัน)
 */
function notifyOff()      { return setNotifyChannel('OFF');   }
function notifyOnWebex()  { return setNotifyChannel('WEBEX'); }
function notifyOnLine()   { return setNotifyChannel('LINE');  }
function notifyOnBoth()   { return setNotifyChannel('BOTH');  }

function setNotifyChannel(v) {
  var rows = readTable('Config');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key) !== 'NOTIFY_CHANNEL') continue;
    updateRow('Config', rows[i]._row, { value: v });
    SpreadsheetApp.flush();
    Logger.log('NOTIFY_CHANNEL = ' + v);
    return v;
  }
  Logger.log('ไม่พบค่าระบบ NOTIFY_CHANNEL — รัน upgradeConfig() ก่อน');
  return '';
}

/** ใส่โทเคนบอต Webex (รันจาก Editor ครั้งเดียว แล้วลบโทเคนออกจากโค้ด) */
function setWebexToken() {
  PropertiesService.getScriptProperties().setProperty('WEBEX_TOKEN', 'ใส่ bot access token ที่นี่');
}

/** เรียกดูสเปซ Webex ทั้งหมดที่บอตถูกเชิญเข้าไป — ใช้หา roomId มาใส่ค่าระบบ */
function listWebexRooms() {
  var token = prop('WEBEX_TOKEN');
  if (!token) return 'ยังไม่ได้ใส่โทเคน — รัน setWebexToken() ก่อน';
  var res = UrlFetchApp.fetch('https://webexapis.com/v1/rooms?max=50', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  var out = (JSON.parse(res.getContentText()).items || []).map(function (r) {
    return r.title + '  →  ' + r.id;
  }).join('\n');
  Logger.log(out || 'บอตยังไม่ได้อยู่ในสเปซไหนเลย');
  return out;
}
