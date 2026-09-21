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
  TOKEN_TTL_DAYS    : 3650,          // ค้างล็อกอินไว้ ออกเมื่อกดปุ่มออกจากระบบเท่านั้น
  DAY_START_HOUR    : 6,             // วันปฏิบัติงานเริ่ม 06:00
  LINE_SOFT_CAP     : 250,           // เกินนี้ส่งเฉพาะเรื่องด่วน
  LINE_HARD_CAP     : 290            // เกินนี้หยุดส่ง LINE
};

// ---------------------------------------------------------------------------
// โครงตาราง — setupAll() ใช้สร้างแท็บและหัวคอลัมน์
// ---------------------------------------------------------------------------
var SCHEMA = {
  Admins         : ['UserId','Name','Password','Role','Status','Apps','Phone','Note','Avatar'],
  Members        : ['UserId','Name','Password','Role','Status','Apps','Phone','Position','Note','Avatar'],
  Config         : ['key','value','note'],
  Checkpoints    : ['cpId','code','name','lat','lng','radiusM','orderNo','requirePhoto',
                    'photoHeading','headingTol','refPhotoFileId','photoHint','active','note'],
  ChecklistItems : ['itemId','cpId','label','type','required','orderNo','active'],
  RoundPlan      : ['planId','dayType','roundNo','schedTime','flexEndTime','graceEarlyMin','graceLateMin','active',
                    'mode','cpCodes','minStayMin'],
  Holidays       : ['date','name','kind'],
  Inspections    : ['inspId','ts','workDate','userId','userName','role','cpId','cpCode','cpName',
                    'lat','lng','distanceM','accuracyM','note','photoUrl'],
  PushSubs       : ['userId','endpoint','p256dh','auth','device','createdAt','active'],
  Shifts         : ['shiftId','workDate','guardUserId','guardName','checkInAt','checkInLat','checkInLng',
                    'checkOutAt','checkOutLat','checkOutLng','status','note',
                    'planId','shiftName','plannedStart','plannedEnd','lateMin','onTime','earlyOutMin',
                    'handoverId','emergency','emergencyReason'],
  ShiftPlan      : ['planId','name','startTime','endTime','graceEarlyMin','lateAfterMin','handoverMin',
                    'requireHandover','active','note'],
  Handovers      : ['hoId','workDate','ts','outUserId','outName','inUserId','inName','note','ackAt','status'],
  Rounds         : ['roundId','workDate','dayType','roundNo','schedAt','openAt','closeAt','flex',
                    'guardUserId','shiftId','status','startedAt','finishedAt','pointsDone','pointsTotal',
                    'mode','cpCodes','minStayMin'],
  Checkins       : ['checkinId','roundId','cpId','userId','userName','ts','clientTs','lat','lng',
                    'accuracyM','distanceM','verifyResult','overrideReason','ua','phase','note'],
  CheckinAnswers : ['checkinId','itemId','value','remark'],
  Incidents      : ['incId','ts','roundId','cpId','userId','userName','category','severity','title',
                    'detail','lat','lng','status','assignedTo','closedAt','closeNote'],
  Attachments    : ['attId','refType','refId','driveFileId','url','takenAt','lat','lng',
                    'heading','headingOk','phase'],
  Notifications  : ['notifId','ts','channel','target','recipients','type','refId','status'],
  AuditLog       : ['ts','userId','action','refType','refId','before','after'],
  Points         : ['workDate','userId','userName','shiftPts','cpPts','roundPts','nightBonus',
                    'outPts','incPts','perfectBonus','streakBonus','adjust','total',
                    'roundsDone','roundsTotal','nightRounds','cpOk','cpOverride','cpNoGps','incidents',
                    'freeChecks','freePts','perfect','streak','note','calcAt'],
  PointsAdjust   : ['adjId','ts','workDate','userId','delta','reason','by'],
  Rewards        : ['rewardId','name','cost','stock','note','active'],
  Redemptions    : ['redId','ts','workDate','userId','userName','rewardId','rewardName','cost',
                    'status','handledBy','handledAt','note']
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
      case 'handoverAck'     : return apiHandoverAck(auth(req), req);
      case 'pingNextShift'   : return apiPingNextShift(auth(req));
      case 'checkin'         : return apiCheckin(auth(req), req);
      case 'incident'        : return apiIncident(auth(req), req);
      case 'myHistory'       : return apiMyHistory(auth(req), req);
      case 'saveProfile'     : return apiSaveProfile(auth(req), req);
      case 'myPoints'        : return apiMyPoints(auth(req));
      case 'ptBoard'         : return apiPtBoard(auth(req));
      case 'redeem'          : return apiRedeem(auth(req), req);

      // --- หัวหน้า / ผู้ดูแล ---
      case 'supervisorBoard' : return apiSupervisorBoard(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'incidentUpdate'  : return apiIncidentUpdate(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'inspect'         : return apiInspect(auth(req, ['SUPERVISOR','ADMIN']), req);
      case 'redeemUpdate'    : return apiRedeemUpdate(auth(req, ['SUPERVISOR','ADMIN']), req);
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
      case 'saveShiftPlan'   : return apiSaveShiftPlan(auth(req, ['ADMIN']), req);
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

/** เติมคอลัมน์ที่ยังไม่มีต่อท้ายหัวตาราง — ปลอดภัยเพราะไม่ขยับคอลัมน์เดิม */
function ensureCols(tab, cols) {
  var sh = sheetOf(tab);
  var w = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, w).getValues()[0].map(function (h) { return String(h).trim(); });
  while (head.length && !head[head.length - 1]) head.pop();
  var add = [];
  cols.forEach(function (c) { if (head.indexOf(c) < 0) add.push(c); });
  if (!add.length) return false;
  sh.getRange(1, head.length + 1, 1, add.length).setValues([add]);
  SpreadsheetApp.flush();
  return true;
}

/** คอลัมน์ที่ระบบรุ่นใหม่ต้องใช้ — เรียกตอนเปิดแอปและตอนสร้างรอบ */
function ensureRoundCols() {
  ensureCols('RoundPlan', ['mode', 'cpCodes', 'minStayMin']);
  ensureCols('Rounds',    ['mode', 'cpCodes', 'minStayMin']);
  ensureCols('Checkins',  ['phase', 'note']);
  ensureCols('Shifts',    ['planId', 'shiftName', 'plannedStart', 'plannedEnd', 'lateMin',
                           'onTime', 'earlyOutMin', 'handoverId', 'emergency', 'emergencyReason']);
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

/** อ่านเวลา HH:mm จากค่าที่อาจเป็นข้อความหรือเป็น Date (Google Sheets ชอบแปลงให้เอง) */
function parseHM(v) {
  if (v instanceof Date) return { h: v.getHours(), m: v.getMinutes() };
  var t = String(v == null ? '' : v).trim();
  if (!t) return null;
  if (t.indexOf('T') > 0) t = t.split('T')[1];
  var h = parseInt(t.split(':')[0], 10), m = parseInt(t.split(':')[1] || '0', 10);
  if (isNaN(h)) return null;
  return { h: h, m: isNaN(m) ? 0 : m };
}

/** ประกอบวันที่ของ base เข้ากับเวลา h:m */
function atTime(base, h, m) {
  return new Date(fmt(base, 'yyyy-MM-dd') + 'T' +
                  ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':00');
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

/**
 * ตรวจระยะห่างจากจุดลงเวลาเข้า-ออกเวร
 * คืน null ถ้าแอดมินยังไม่ได้ตั้งจุด (ระบบจะไม่บังคับอะไรเลย)
 */
function shiftPointCheck(lat, lng) {
  var la = num(cfgGet('SHIFT_LAT', 0)), ln = num(cfgGet('SHIFT_LNG', 0));
  if (!la || !ln) return null;
  var rad = num(cfgGet('SHIFT_RADIUS_M', 20), 20);
  if (!lat || !lng) return { dist: -1, radiusM: rad, inside: false };
  var d = Math.round(haversine(lat, lng, la, ln));
  return { dist: d, radiusM: rad, inside: d <= rad };
}

/** ข้อความบันทึกระยะและเหตุผลยืนยันเองลงคอลัมน์ note ของแท็บ Shifts */
function shiftNote(phase, chk, req) {
  var parts = [];
  if (req.note) parts.push(String(req.note));
  if (chk) parts.push(phase + ' ห่างจุดลงเวลา ' + (chk.dist < 0 ? 'ไม่ทราบพิกัด' : chk.dist + ' ม.'));
  if (req.overrideReason) parts.push('ยืนยันเอง: ' + String(req.overrideReason));
  return parts.join(' · ');
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
  // ต้องเข้ารหัสเป็น UTF-8 ให้ชัดเจน ไม่งั้นชื่อภาษาไทยในโทเคนจะกลายเป็น ???
  var body = Utilities.base64EncodeWebSafe(
               Utilities.newBlob(JSON.stringify(payload)).getBytes());
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

/** คืนค่าทุกคอลัมน์ที่ชื่อตรงกับรายการ — ใช้ตอนล็อกอินเพื่อให้ใช้ได้ทั้ง UserId และเบอร์โทร */
function pickAll(row, names) {
  var out = [];
  for (var i = 0; i < names.length; i++) {
    for (var k in row) {
      if (String(k).trim().toLowerCase() === names[i].toLowerCase() &&
          row[k] !== '' && row[k] !== null) out.push(String(row[k]).trim());
    }
  }
  return out;
}

/** ตัดช่องว่าง ขีด วงเล็บ ออกก่อนเทียบ — เบอร์โทรพิมพ์แบบไหนก็เข้าได้ */
function normId(v) {
  return String(v == null ? '' : v).replace(/[\s\-().]/g, '').toLowerCase();
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

/** หาแถวผู้ใช้ในชีตแพลตฟอร์ม พร้อมเลขแถวและหัวคอลัมน์ เพื่อแก้ไขข้อมูลส่วนตัว */
function platformRow(userId) {
  var ss = platformSS();
  if (!ss) return null;
  var tabs = ['Admins', 'Members'];
  for (var t = 0; t < tabs.length; t++) {
    var sh = ss.getSheetByName(tabs[t]);
    if (!sh || sh.getLastRow() < 2) continue;
    var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
    var head = vals[0].map(function (h) { return String(h).trim(); });
    for (var i = 1; i < vals.length; i++) {
      var o = {};
      for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vals[i][c];
      var id = String(pick(o, ['UserId','Username','Phone','เบอร์โทร','Email']) || '').trim();
      if (id && id === String(userId)) return { sh: sh, head: head, row: i + 1, obj: o };
    }
  }
  return null;
}

/** เขียนค่าลงแถวผู้ใช้ตามชื่อคอลัมน์ — คอลัมน์ไหนยังไม่มีจะสร้างต่อท้ายให้ */
function platformSet(rec, patch) {
  Object.keys(patch).forEach(function (k) {
    if (rec.head.indexOf(k) < 0) {
      rec.head.push(k);
      rec.sh.getRange(1, rec.head.length).setValue(k);
    }
  });
  var w = rec.head.length;
  var vals = rec.sh.getRange(rec.row, 1, 1, w).getValues()[0];
  Object.keys(patch).forEach(function (k) { vals[rec.head.indexOf(k)] = patch[k]; });
  rec.sh.getRange(rec.row, 1, 1, w).setValues([vals]);
  SpreadsheetApp.flush();
}

/** ข้อมูลส่วนตัวที่ผู้ใช้แก้ไขเองได้ */
function myProfile(userId) {
  var r = platformRow(userId);
  if (!r) return { phone: '', avatar: '' };
  return { phone: String(pick(r.obj, ['Phone','เบอร์โทร']) || ''),
           avatar: String(r.obj.Avatar || '') };
}

/**
 * ผู้ใช้แก้ข้อมูลส่วนตัวของตัวเอง — เบอร์โทร / รหัสผ่าน / รูปประจำตัว
 * ชื่อ-สกุลและสิทธิ์ ยังต้องให้ผู้ดูแลระบบแก้ในชีตเท่านั้น
 */
function apiSaveProfile(me, req) {
  var rec = platformRow(me.userId);
  if (!rec) return err('ไม่พบบัญชีผู้ใช้นี้ในระบบ');

  var patch = {}, changed = [];

  if (req.phone !== undefined) {
    if (!String(rec.obj.UserId || '').trim())
      return err('บัญชีนี้ใช้เบอร์โทรเป็นชื่อผู้ใช้ จึงเปลี่ยนเองไม่ได้ กรุณาแจ้งผู้ดูแลระบบ');
    var ph = String(req.phone || '').replace(/[^0-9+\-]/g, '').trim();
    if (ph && !/^[0-9+\-]{9,15}$/.test(ph)) return err('รูปแบบเบอร์โทรไม่ถูกต้อง');
    patch.Phone = ph;
    changed.push('เบอร์โทร');
  }

  if (req.newPassword) {
    if (!passwordMatch(pick(rec.obj, ['Password','Pass','รหัสผ่าน']), String(req.oldPassword || '')))
      return err('รหัสผ่านเดิมไม่ถูกต้อง');
    var np = String(req.newPassword);
    if (np.length < 6) return err('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
    patch.Password = sha256Hex(np);          // เก็บเป็นค่าเข้ารหัส ไม่เก็บรหัสผ่านตรง ๆ
    changed.push('รหัสผ่าน');
  }

  var avatar = '';
  if (req.avatar) {
    var saved = savePhoto(req.avatar, 'AVATAR', me.userId, { phase: 'รูปประจำตัว' });
    if (!saved) return err('บันทึกรูปไม่สำเร็จ');
    avatar = saved.url;
    patch.Avatar = avatar;
    changed.push('รูปประจำตัว');
  }

  if (!changed.length) return err('ไม่มีข้อมูลที่ต้องแก้ไข');
  platformSet(rec, patch);
  audit(me.userId, 'PROFILE_UPDATE', 'USER', me.userId, null, { changed: changed });

  var now = myProfile(me.userId);
  return ok({ changed: changed, phone: now.phone, avatar: now.avatar });
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
      // เทียบกับ "ทุก" ชื่อผู้ใช้ที่แถวนี้มี — เข้าได้ทั้งรหัสผู้ใช้และเบอร์โทร
      var ids = pickAll(r, ['Username','User','UserId','Phone','เบอร์โทร','รหัสผู้ใช้','Email','อีเมล']);
      var want = normId(user);
      var hit = false;
      for (var q = 0; q < ids.length; q++) if (normId(ids[q]) === want) { hit = true; break; }
      if (!hit) continue;
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
/**
 * แผนรอบรุ่นที่ 2 — เพิ่มรอบประจำจุดในวันทำการ 08:00 / 12:00 / 15:00
 * เขียนทับเฉพาะแถว WORKDAY เท่านั้น แถววันหยุดไม่แตะ
 */
var ROUNDPLAN_VER = 2;
var WORKDAY_PLAN = [
  // roundNo, schedTime, flexEndTime, graceEarly, graceLate, mode, cpCodes, minStayMin
  [1, '08:00', '',      15, 30, 'STATION', 'C', 60],
  [2, '12:00', '',      15, 30, 'STATION', 'C', 60],
  [3, '15:00', '',      15, 30, 'STATION', 'C', 60],
  [4, '18:00', '',      15, 60, 'PATROL',  '',  ''],
  [5, '20:00', '',      15, 60, 'PATROL',  '',  ''],
  [6, '22:00', '',      15, 60, 'PATROL',  '',  ''],
  [7, '00:00', '',      15, 60, 'PATROL',  '',  ''],
  [8, '00:00', '06:00', 15, 60, 'PATROL',  '',  ''],
  [9, '00:00', '06:00', 15, 60, 'PATROL',  '',  '']
];

function migrateRoundPlan() {
  ensureRoundCols();
  if (num(cfgGet('ROUNDPLAN_VER', 0)) >= ROUNDPLAN_VER) return false;

  var sh = sheetOf('RoundPlan');
  var rows = readTable('RoundPlan');
  // ลบเฉพาะแถววันทำการ ไล่จากล่างขึ้นบนกันแถวเลื่อน
  rows.filter(function (r) { return String(r.dayType) === 'WORKDAY'; })
      .sort(function (a, b) { return b._row - a._row; })
      .forEach(function (r) { sh.deleteRow(r._row); });

  WORKDAY_PLAN.forEach(function (x) {
    appendRow('RoundPlan', {
      planId: uid(), dayType: 'WORKDAY', roundNo: x[0], schedTime: x[1], flexEndTime: x[2],
      graceEarlyMin: x[3], graceLateMin: x[4], active: 'TRUE',
      mode: x[5], cpCodes: x[6], minStayMin: x[7]
    });
  });
  // แถววันหยุดเดิมให้ระบุโหมดเป็นเดินตรวจให้ชัด
  readTable('RoundPlan').forEach(function (r) {
    if (String(r.dayType) === 'HOLIDAY' && !String(r.mode || ''))
      updateRow('RoundPlan', r._row, { mode: 'PATROL' });
  });

  cfgSet('ROUNDPLAN_VER', ROUNDPLAN_VER,
         'รุ่นของแผนรอบ — เพิ่มเลขนี้ในโค้ดเมื่อต้องการเขียนแผนรอบวันทำการใหม่ทับทั้งชุด');
  SpreadsheetApp.flush();
  return true;
}

/** ลายเซ็นของรอบ ใช้กันสร้างซ้ำโดยไม่ต้องพึ่งเลขรอบ */
function roundSig(hhmm2, isFlex) { return String(hhmm2) + '|' + (isFlex ? 'F' : ''); }

function generateRounds(workDate) {
  migrateRoundPlan();
  var dayType = isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY';
  var plans = readTable('RoundPlan').filter(function (p) {
    return String(p.dayType) === dayType && bool(p.active);
  }).sort(function (a, b) { return num(a.roundNo) - num(b.roundNo); });

  // นับรอบที่มีอยู่แล้วของวันนี้ตามลายเซ็น (เวลานัด + เป็นรอบยืดหยุ่นหรือไม่)
  var have = {};
  readTable('Rounds').forEach(function (r) {
    if (dstr(r.workDate) !== workDate) return;
    var d = parseIso(r.schedAt);
    if (isNaN(d.getTime())) return;
    var sig = roundSig(fmt(d, 'HH:mm'), bool(r.flex));
    have[sig] = (have[sig] || 0) + 1;
  });

  var cpTotal = readTable('Checkpoints').filter(function (c) { return bool(c.active); }).length;
  var now = Date.now();
  var made = 0;

  plans.forEach(function (p) {
    var st = parseHM(p.schedTime);
    if (!st) return;
    var sig = roundSig(hhmmOf(p.schedTime), !!parseHM(p.flexEndTime));
    if (have[sig] > 0) { have[sig]--; return; }          // มีรอบนี้อยู่แล้ว

    var base = new Date(workDate + 'T12:00:00');
    if (st.h < CFG.DAY_START_HOUR) base.setDate(base.getDate() + 1);  // รอบดึกนับเป็นวันถัดไปตามปฏิทิน
    var sched = atTime(base, st.h, st.m);

    var mode = String(p.mode || 'PATROL').toUpperCase();
    var stay = num(p.minStayMin, 0);

    var en = parseHM(p.flexEndTime);
    var open, close, flex = '';
    if (en) {
      // รอบยืดหยุ่น: เดินเมื่อไหร่ก็ได้ภายในช่วง schedTime ถึง flexEndTime
      flex = 'TRUE';
      var eb = new Date(workDate + 'T12:00:00');
      if (en.h <= CFG.DAY_START_HOUR) eb.setDate(eb.getDate() + 1);
      var end = atTime(eb, en.h, en.m);
      if (end.getTime() <= sched.getTime()) end = new Date(end.getTime() + 86400000);
      open = sched; close = end;
    } else {
      open  = new Date(sched.getTime() - num(p.graceEarlyMin, 15) * 60000);
      // รอบประจำจุดต้องเผื่อเวลาให้ยืนครบก่อน ถึงจะเริ่มนับผ่อนผัน
      close = new Date(sched.getTime() + (stay + num(p.graceLateMin, 60)) * 60000);
    }

    // ไม่สร้างรอบที่ปิดไปแล้ว เพื่อไม่ให้ขึ้นว่า "ขาด" ทั้งที่เพิ่งเพิ่มแผนเข้ามา
    if (close.getTime() < now) return;

    appendRow('Rounds', {
      roundId: uid(), workDate: workDate, dayType: dayType, roundNo: num(p.roundNo),
      schedAt: toIso(sched), openAt: toIso(open), closeAt: toIso(close), flex: flex,
      guardUserId: '', shiftId: '', status: 'PENDING',
      startedAt: '', finishedAt: '', pointsDone: 0,
      pointsTotal: (mode === 'STATION') ? 2 : cpTotal,
      mode: mode, cpCodes: String(p.cpCodes || ''), minStayMin: stay
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
    var onDuty = shiftDays();   // วันที่ไม่มีใครเข้าเวร = ไม่ต้องแจ้งเตือน

    rows.forEach(function (r) {
      var st = String(r.status);
      if (String(r.mode || '').toUpperCase() === 'FREE') return;   // รอบอิสระไม่มีวันขาด
      if (st === 'COMPLETE' || st === 'MISSED' || st === 'PARTIAL') return;
      var close = parseIso(r.closeAt);
      if (close.getTime() < now.getTime()) {
        var next = (num(r.pointsDone) > 0) ? 'PARTIAL' : 'MISSED';
        updateRow('Rounds', r._row, { status: next, finishedAt: nowIso() });
        if (onDuty[dstr(r.workDate)])
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
/**
 * วันปฏิบัติงานที่มี รปภ. กดลงเวลาเข้าเวรแล้ว — ใช้เป็นสวิตช์ของการแจ้งเตือนทั้งระบบ
 * ไม่มีใครเข้าเวร = ไม่ส่งแจ้งเตือนใด ๆ ของวันนั้น
 */
function shiftDays() {
  var d = {};
  readTable('Shifts').forEach(function (s) {
    if (s.checkInAt) d[dstr(s.workDate)] = true;
  });
  return d;
}

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

    // เตือนเฉพาะวันที่ รปภ. กดลงเวลาเข้าเวรแล้วเท่านั้น
    var onDuty = shiftDays();

    var sent = 0;
    readTable('Rounds').forEach(function (r) {
      if (String(r.status) !== 'PENDING' || r.startedAt) return;
      if (!onDuty[dstr(r.workDate)]) return;
      var id    = String(r.roundId);
      var sched = parseIso(r.schedAt);
      var close = parseIso(r.closeAt);
      if (close.getTime() < now) return;
      var no = num(r.roundNo), hhmm = fmt(sched, 'HH:mm');

      // รอบยืดหยุ่น: ไม่เตือนตามเวลานัด แต่เตือนเมื่อใกล้หมดช่วงแล้วยังไม่เริ่ม
      if (bool(r.flex)) {
        var leftMs = close.getTime() - now;
        var warnMs = num(cfgGet('FLEX_REMIND_LEFT_MIN', 60), 60) * 60000;
        if (leftMs <= warnMs && !already['ROUND_LATE|' + id]) {
          if (notify('⚠️ รอบที่ ' + no + ' (ช่วงยืดหยุ่น ' + hhmm + '–' + fmt(close, 'HH:mm') + ' น.) ' +
                     'เหลือเวลาอีก ' + Math.max(1, Math.round(leftMs / 60000)) + ' นาที ยังไม่มีการเช็คอิน',
                     'HIGH', 'ROUND_LATE', id, 'GUARD')) sent++;
        }
        return;
      }

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
  ensureRoundCols();
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

  var allCk = readTable('Checkins');
  var stMap = {};   // roundId -> { inAt, outAt } ของรอบประจำจุด
  allCk.forEach(function (c) {
    var ph = String(c.phase || '').toUpperCase();
    if (ph !== 'IN' && ph !== 'OUT') return;
    var k = String(c.roundId);
    if (!stMap[k]) stMap[k] = { inAt: '', outAt: '' };
    if (ph === 'IN'  && (!stMap[k].inAt  || String(c.ts) < stMap[k].inAt))  stMap[k].inAt  = String(c.ts);
    if (ph === 'OUT' && (!stMap[k].outAt || String(c.ts) < stMap[k].outAt)) stMap[k].outAt = String(c.ts);
  });

  var rounds = readTable('Rounds').filter(function (r) { return dstr(r.workDate) === workDate; })
    .sort(function (a, b) {
      var x = String(a.schedAt), y = String(b.schedAt);
      if (x !== y) return x < y ? -1 : 1;
      return num(a.roundNo) - num(b.roundNo);
    })
    .map(function (r) {
      var st = stMap[String(r.roundId)] || { inAt: '', outAt: '' };
      return { roundId: String(r.roundId), roundNo: num(r.roundNo), status: String(r.status),
               schedAt: String(r.schedAt), openAt: String(r.openAt), closeAt: String(r.closeAt),
               flex: bool(r.flex),
               mode: String(r.mode || 'PATROL').toUpperCase(),
               cpCodes: String(r.cpCodes || ''), minStayMin: num(r.minStayMin, 0),
               inAt: st.inAt, outAt: st.outAt,
               pointsDone: num(r.pointsDone), pointsTotal: num(r.pointsTotal),
               guardUserId: String(r.guardUserId || '') };
    });

  var doneMap = {};
  allCk.forEach(function (c) {
    if (!doneMap[c.roundId]) doneMap[c.roundId] = [];
    doneMap[c.roundId].push(String(c.cpId));
  });

  var allShifts = readTable('Shifts');
  var shift = null, myOpenRow = null;
  allShifts.forEach(function (s) {
    if (String(s.guardUserId) === me.userId && s.checkInAt && !s.checkOutAt) {
      myOpenRow = s;
      shift = { shiftId: String(s.shiftId), checkInAt: String(s.checkInAt),
                planId: String(s.planId || ''), shiftName: String(s.shiftName || ''),
                plannedStart: String(s.plannedStart || ''), plannedEnd: String(s.plannedEnd || ''),
                lateMin: num(s.lateMin), onTime: !!String(s.onTime || '') };
    }
  });

  // คนอื่นที่อยู่ระหว่างเวรตอนนี้ — ใช้บอกว่ามีผู้รับเวรแล้วหรือยัง
  var othersOn = allShifts.filter(function (s) {
    return s.checkInAt && !s.checkOutAt && String(s.guardUserId) !== me.userId;
  }).map(function (s) {
    return { userId: String(s.guardUserId), name: String(s.guardName || ''),
             checkInAt: String(s.checkInAt), shiftName: String(s.shiftName || '') };
  });

  // เรื่องคงค้างที่เพิ่งรับเวรมาและยังไม่กดรับทราบ
  var pendingHo = null;
  readTable('Handovers').forEach(function (h) {
    if (String(h.inUserId) !== me.userId || h.ackAt) return;
    if (!pendingHo || String(h.ts) > pendingHo.ts)
      pendingHo = { hoId: String(h.hoId), ts: String(h.ts), from: String(h.outName || ''),
                    note: String(h.note || '') };
  });

  return ok({
    user: { userId: me.userId, name: me.name, role: me.role },
    workDate: workDate, dayType: isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY',
    serverTime: nowIso(), checkpoints: cps, checklist: items,
    profile: myProfile(me.userId),
    // ต่ออายุโทเคนทุกครั้งที่เปิดแอป — เซสชันจะไม่หมดอายุเองตราบใดที่ยังใช้งานอยู่
    token: signToken({ userId: me.userId, name: me.name, role: me.role,
                       exp: toIso(new Date(Date.now() + CFG.TOKEN_TTL_DAYS * 86400000)) }),
    remindBeforeMin: num(cfgGet('REMIND_BEFORE_MIN', 10), 10),
    shiftPoint: (function () {
      var la = num(cfgGet('SHIFT_LAT', 0)), ln = num(cfgGet('SHIFT_LNG', 0));
      return (la && ln) ? { lat: la, lng: ln, radiusM: num(cfgGet('SHIFT_RADIUS_M', 20), 20) } : null;
    })(),
    rounds: rounds, done: doneMap, shift: shift,
    shiftPlans: shiftOptions(workDate), othersOnDuty: othersOn, pendingHandover: pendingHo,
    emergencyReasons: EMERGENCY_REASONS,
    categories: String(cfgGet('INCIDENT_CATEGORIES',
      'บุคคลต้องสงสัย,ประตู/รั้วผิดปกติ,ไฟฟ้า/แสงสว่าง,น้ำรั่ว/ท่วม,ไฟไหม้/ควัน,ทรัพย์สินเสียหาย,สัตว์,อื่น ๆ')).split(',')
  });
}

function apiCheckin(me, req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return err('ระบบกำลังบันทึกรายการอื่น ลองใหม่อีกครั้ง');
  try {
    var roundId = String(req.roundId || '');
    var cpId    = String(req.cpId || '');
    if (!roundId || !cpId) return err('ข้อมูลไม่ครบ');

    var round = null;
    if (roundId.toUpperCase() === 'FREE') {
      round = freeRoundOf(workDateOf(new Date()));
      if (!round) return err('สร้างรอบตรวจเพิ่มไม่สำเร็จ');
      roundId = String(round.roundId);
    } else {
      var rounds = readTable('Rounds');
      for (var i = 0; i < rounds.length; i++) if (String(rounds[i].roundId) === roundId) round = rounds[i];
    }
    if (!round) return err('ไม่พบรอบเดินตรวจนี้');
    assertUnlocked(dstr(round.workDate));

    // เลยเวลาปิดรอบแล้วบันทึกไม่ได้ — ยกเว้นรายการที่ค้างอยู่ในคิวออฟไลน์
    // (เทียบเวลาที่เครื่องบันทึกไว้ตอนเดินจริง ถ้ายังอยู่ในช่วงก็ให้ผ่าน)
    var isFree  = String(round.mode || '').toUpperCase() === 'FREE';
    var closeMs = parseIso(round.closeAt).getTime();
    var cts     = new Date(String(req.clientTs || '')).getTime();
    var atMs    = isNaN(cts) ? Date.now() : Math.min(cts, Date.now());
    if (!isFree && atMs > closeMs)
      return err('รอบที่ ' + num(round.roundNo) + ' ปิดไปแล้วเมื่อ ' +
                 fmt(parseIso(round.closeAt), 'HH:mm') + ' น. — บันทึกไม่ได้');

    var cp = null;
    readTable('Checkpoints').forEach(function (c) { if (String(c.cpId) === cpId) cp = c; });
    if (!cp) return err('ไม่พบจุดตรวจ');

    var mode  = String(round.mode || 'PATROL').toUpperCase();
    var mine  = readTable('Checkins').filter(function (c) { return String(c.roundId) === roundId; });
    var phase = '';

    if (mode === 'STATION') {
      // รอบประจำจุด — บันทึกได้เฉพาะจุดที่กำหนด และต้องกดสองครั้ง เข้า/ออก
      var allow = String(round.cpCodes || '').split(',')
                    .map(function (x) { return String(x).trim(); })
                    .filter(function (x) { return x; });
      if (allow.length && allow.indexOf(String(cp.code)) < 0)
        return err('รอบนี้เป็นรอบประจำจุด บันทึกได้เฉพาะจุด ' + allow.join(', '));

      var inRow = null, outRow = null;
      mine.forEach(function (c) {
        var ph = String(c.phase || '').toUpperCase();
        if (ph === 'IN'  && (!inRow  || String(c.ts) < String(inRow.ts)))  inRow  = c;
        if (ph === 'OUT' && (!outRow || String(c.ts) < String(outRow.ts))) outRow = c;
      });
      if (outRow) return err('รอบนี้จบการประจำจุดไปแล้ว');

      if (!inRow) {
        phase = 'IN';
      } else {
        phase = 'OUT';
        var need = num(round.minStayMin, 60);
        var inMs = parseIso(inRow.ts).getTime();
        var mins = Math.floor((Date.now() - inMs) / 60000);
        if (mins < need)
          return err('ยังประจำจุดไม่ครบ ' + need + ' นาที — ผ่านมาแล้ว ' + mins +
                     ' นาที เหลืออีก ' + (need - mins) + ' นาที');
      }
    } else if (!isFree) {
      // รอบเดินตรวจ — กันเช็คอินซ้ำจุดเดิมในรอบเดียวกัน
      var already = mine.some(function (c) { return String(c.cpId) === cpId; });
      if (already) return err('จุดนี้เช็คอินในรอบนี้ไปแล้ว');
    }

    var lat = num(req.lat), lng = num(req.lng), acc = num(req.accuracyM, 999);
    var dist = (lat && lng) ? haversine(lat, lng, num(cp.lat), num(cp.lng)) : -1;
    var radius = num(cp.radiusM, 25);
    // จุดในอาคารสัญญาณอ่อนเป็นปกติ รอบประจำจุดจึงผ่อนรัศมีให้กว้างขึ้น
    if (mode === 'STATION') radius = Math.max(radius, num(cfgGet('STATION_RADIUS_M', 40), 40));

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
      overrideReason: String(req.overrideReason || ''), ua: String(req.ua || '').substring(0, 200),
      phase: phase, note: String(req.note || '').substring(0, 200)
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
    if (isFree) {
      patch.status = 'OPEN';
      patch.pointsTotal = done;
    } else {
      if (String(round.status) === 'PENDING') { patch.status = 'IN_PROGRESS'; patch.startedAt = nowIso(); }
      if (done >= total) { patch.status = 'COMPLETE'; patch.finishedAt = nowIso(); }
    }
    updateRow('Rounds', round._row, patch);

    return ok({ checkinId: checkinId, verify: verify, distanceM: dist, phase: phase,
                mode: isFree ? 'FREE' : mode, roundId: roundId,
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
               status: String(s.status),
               shiftName: String(s.shiftName || ''),
               plannedStart: String(s.plannedStart || ''), plannedEnd: String(s.plannedEnd || ''),
               lateMin: num(s.lateMin), onTime: String(s.onTime || ''),
               earlyOutMin: num(s.earlyOutMin),
               handoverId: String(s.handoverId || ''),
               emergency: bool(s.emergency), emergencyReason: String(s.emergencyReason || '') };
    });

  var handovers = readTable('Handovers').filter(function (h) { return dstr(h.workDate) === workDate; })
    .map(function (h) {
      return { hoId: String(h.hoId), ts: String(h.ts),
               outName: String(h.outName || ''), inName: String(h.inName || ''),
               note: String(h.note || ''), ackAt: String(h.ackAt || ''), status: String(h.status || '') };
    }).sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });

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
               flex: bool(r.flex),
               mode: String(r.mode || 'PATROL').toUpperCase(),
               cpCodes: String(r.cpCodes || ''), minStayMin: num(r.minStayMin),
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
               phase: String(c.phase || ''), note: String(c.note || ''),
               overrideReason: String(c.overrideReason || '') };
    }),
    incidents: incidents,
    handovers: handovers,
    inspections: readTable('Inspections')
      .filter(function (i) { return dstr(i.workDate) === workDate; })
      .map(function (i) {
        return { inspId: String(i.inspId), ts: String(i.ts), userName: String(i.userName),
                 role: String(i.role), cpCode: String(i.cpCode), cpName: String(i.cpName),
                 lat: num(i.lat), lng: num(i.lng), distanceM: num(i.distanceM),
                 note: String(i.note || ''), photoUrl: String(i.photoUrl || '') };
      }).sort(function (a, b) { return a.ts < b.ts ? 1 : -1; })
  });
}

/**
 * สุ่มตรวจโดยหัวหน้าเวร/ผู้ดูแลระบบ — ไม่ผูกกับรอบและไม่ผูกกับเวลา
 * บันทึกแยกจากการเดินตรวจของ รปภ. เพื่อไม่ให้ไปนับรวมเป็นผลงานของเขา
 */
function apiInspect(me, req) {
  var cpId = String(req.cpId || '');
  var cp = null;
  readTable('Checkpoints').forEach(function (c) { if (String(c.cpId) === cpId) cp = c; });
  if (!cp) return err('ไม่พบจุดตรวจนี้');

  var lat = num(req.lat), lng = num(req.lng);
  var dist = (lat && lng) ? haversine(lat, lng, num(cp.lat), num(cp.lng)) : -1;

  var id = uid();
  var url = '';
  if (req.photo) {
    var saved = savePhoto(req.photo, 'INSPECT', id, { lat: lat, lng: lng, phase: 'สุ่มตรวจ' });
    if (saved) url = saved.url;
  }

  appendRow('Inspections', {
    inspId: id, ts: nowIso(), workDate: workDateOf(new Date()),
    userId: me.userId, userName: me.name, role: me.role,
    cpId: cpId, cpCode: String(cp.code), cpName: String(cp.name),
    lat: lat, lng: lng, distanceM: dist, accuracyM: num(req.accuracyM, 999),
    note: String(req.note || ''), photoUrl: url
  });
  audit(me.userId, 'INSPECT', 'CHECKPOINT', cpId, null, { distanceM: dist });
  return ok({ inspId: id, distanceM: dist, photoUrl: url });
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
      // รอบยืดหยุ่น: เดินภายในช่วงถือว่าตรงเวลา
      if (bool(r.flex) ||
          parseIso(r.startedAt).getTime() - parseIso(r.schedAt).getTime() <= 15 * 60000) b.onTime++;
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
    return bool(r.flex) ||
           parseIso(r.startedAt).getTime() - parseIso(r.schedAt).getTime() <= 15 * 60000; }).length;
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
        return String(a.takenAt).indexOf(month) === 0; }).length,
      inspections: readTable('Inspections').filter(function (i) {
        return monthOf(dstr(i.workDate)) === month; }).length
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
    shiftPlan:   seedShiftPlan().map(cleanRow),
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
  ensureRoundCols();
  var c = req.item || {};
  var rec = {
    planId: String(c.planId || uid()), dayType: String(c.dayType || 'WORKDAY'),
    roundNo: num(c.roundNo, 1), schedTime: String(c.schedTime || '18:00'),
    flexEndTime: String(c.flexEndTime || ''),
    graceEarlyMin: num(c.graceEarlyMin, 15), graceLateMin: num(c.graceLateMin, 60),
    active: bool(c.active) ? 'TRUE' : 'FALSE',
    mode: String(c.mode || 'PATROL').toUpperCase(),
    cpCodes: String(c.cpCodes || '').toUpperCase().replace(/\s+/g, ''),
    minStayMin: String(c.minStayMin === '' || c.minStayMin == null ? '' : num(c.minStayMin, 0))
  };
  if (rec.mode !== 'STATION') { rec.mode = 'PATROL'; rec.cpCodes = ''; rec.minStayMin = ''; }
  var found = null;
  readTable('RoundPlan').forEach(function (r) { if (String(r.planId) === rec.planId) found = r; });
  if (found) updateRow('RoundPlan', found._row, rec); else appendRow('RoundPlan', rec);
  audit(me.userId, 'ROUNDPLAN_SAVE', 'PLAN', rec.planId, null, rec);
  return ok({ item: rec });
}

function apiSaveShiftPlan(me, req) {
  ensureRoundCols();
  var c = req.item || {};
  var rec = {
    planId: String(c.planId || uid()),
    name: String(c.name || 'กะใหม่'),
    startTime: String(c.startTime || '08:00'),
    endTime: String(c.endTime || '18:00'),
    graceEarlyMin: num(c.graceEarlyMin, 15),
    lateAfterMin: num(c.lateAfterMin, 15),
    handoverMin: num(c.handoverMin, 15),
    requireHandover: bool(c.requireHandover) ? 'TRUE' : 'FALSE',
    active: bool(c.active) ? 'TRUE' : 'FALSE',
    note: String(c.note || '')
  };
  if (!parseHM(rec.startTime) || !parseHM(rec.endTime)) return err('เวลาเริ่ม/เลิกกะต้องเป็นรูปแบบ HH:mm');
  var found = null;
  readTable('ShiftPlan').forEach(function (r) { if (String(r.planId) === rec.planId) found = r; });
  if (found) updateRow('ShiftPlan', found._row, rec); else appendRow('ShiftPlan', rec);
  audit(me.userId, 'SHIFTPLAN_SAVE', 'SHIFTPLAN', rec.planId, found || null, rec);
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
  migrateColumns();
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

  ['SHIFT_LAT', '', 'ละติจูดของจุดลงเวลาเข้า-ออกเวร (ตั้งจากหน้าแอดมิน)'],
  ['SHIFT_LNG', '', 'ลองจิจูดของจุดลงเวลาเข้า-ออกเวร'],
  ['SHIFT_RADIUS_M', 20, 'รัศมีที่ยอมให้ลงเวลาเข้า-ออกเวรได้ (เมตร)'],

  ['NOTIFY_CHANNEL', 'WEBEX', 'ช่องทางแจ้งเตือน: WEBEX (ฟรี ไม่จำกัด) · LINE · BOTH · OFF'],
  ['WEBEX_GUARD_ROOM', '', 'roomId ของสเปซ Webex ที่ รปภ. อยู่ (เตือนก่อนถึงรอบ)'],
  ['WEBEX_GUARD_EMAILS', '', 'อีเมล Webex ของ รปภ. รายคน คั่นด้วยจุลภาค (ใช้แทนหรือเสริมสเปซ)'],
  ['WEBEX_SUPERVISOR_ROOM', '', 'roomId ของสเปซหัวหน้าเวร (ว่างไว้ = ใช้สเปซเดียวกับ รปภ.)'],
  ['WEBEX_SUPERVISOR_EMAILS', '', 'อีเมล Webex ของหัวหน้าเวร คั่นด้วยจุลภาค'],
  ['REMIND_BEFORE_MIN', 10, 'เตือนล่วงหน้ากี่นาทีก่อนถึงเวลารอบ'],
  ['REMIND_LATE_MIN', 20, 'เลยเวลารอบกี่นาทีแล้วยังไม่เริ่ม ให้เตือนซ้ำ'],
  ['FLEX_REMIND_LEFT_MIN', 60, 'รอบยืดหยุ่น: เหลือเวลาอีกกี่นาทีแล้วยังไม่เดิน ให้เตือน'],

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

/**
 * เพิ่มคอลัมน์ใหม่ที่ SCHEMA มีแต่ในชีตยังไม่มี — รันซ้ำได้ ไม่ย้ายหรือลบคอลัมน์เดิม
 * ใช้ตอนอัปเกรดโครงสร้างฐานข้อมูลของระบบที่ใช้งานอยู่แล้ว
 */
function migrateColumns() {
  var added = [];
  Object.keys(SCHEMA).forEach(function (tab) {
    var sh = sheetOf(tab);
    var w = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, w).getValues()[0].map(function (h) { return String(h).trim(); });
    while (head.length && !head[head.length - 1]) head.pop();
    SCHEMA[tab].forEach(function (col, i) {
      if (head.indexOf(col) >= 0) return;
      // แทรกตรงตำแหน่งเดียวกับใน SCHEMA — ห้ามต่อท้าย ไม่งั้น setupSheets จะเปลี่ยนชื่อหัวคอลัมน์ทับข้อมูลเดิม
      var at = i + 1;
      if (at <= sh.getLastColumn()) sh.insertColumnBefore(at);
      sh.getRange(1, at).setValue(col);
      sh.getRange(1, at, sh.getMaxRows(), 1).setNumberFormat('@');
      head.splice(i, 0, col);
      added.push(tab + '.' + col);
    });
  });
  SpreadsheetApp.flush();
  Logger.log(added.length ? ('เพิ่มคอลัมน์: ' + added.join(', ')) : 'โครงสร้างครบแล้ว ไม่มีอะไรต้องเพิ่ม');
  return added;
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
  // สองรอบสุดท้ายของแต่ละประเภทวันเป็น "รอบยืดหยุ่น" — เดินเมื่อไหร่ก็ได้ในช่วง 00:00–06:00
  var work = ['18:00','20:00','22:00','00:00','00:00','00:00'];
  var workFlex = ['','','','','06:00','06:00'];
  work.forEach(function (t, i) {
    appendRow('RoundPlan', { planId: uid(), dayType: 'WORKDAY', roundNo: i + 1, schedTime: t,
                             flexEndTime: workFlex[i], graceEarlyMin: 15, graceLateMin: 60, active: 'TRUE' });
  });
  var holi = ['06:00','09:00','12:00','15:00','18:00','20:00','22:00','00:00','00:00','00:00'];
  var holiFlex = ['','','','','','','','','06:00','06:00'];
  holi.forEach(function (t, i) {
    appendRow('RoundPlan', { planId: uid(), dayType: 'HOLIDAY', roundNo: i + 1, schedTime: t,
                             flexEndTime: holiFlex[i], graceEarlyMin: 15, graceLateMin: 60, active: 'TRUE' });
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
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'rebuildPoints') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('rebuildPoints').timeBased().atHour(6).nearMinute(15).everyDays(1)
           .inTimezone(CFG.TZ).create();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyPointsDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyPointsDigest').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY)
           .atHour(8).inTimezone(CFG.TZ).create();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickShifts') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickShifts').timeBased().everyMinutes(15).create();
}

/** ซ่อมข้อมูลที่ Sheets แปลงชนิดไปแล้ว แล้วสร้างรอบใหม่ */
function fixAndRebuild() {
  setupSheets();
  migrateColumns();
  var rp = sheetOf('RoundPlan');
  if (rp.getLastRow() > 1) {
    var head = rp.getRange(1, 1, 1, rp.getLastColumn()).getValues()[0]
                 .map(function (h) { return String(h).trim(); });
    ['schedTime', 'flexEndTime'].forEach(function (col) {
      var c = head.indexOf(col) + 1;
      if (!c) return;
      var vals = rp.getRange(2, c, rp.getLastRow() - 1, 1).getValues();
      var out = vals.map(function (v) {
        var x = v[0];
        if (x === '' || x === null) return [''];
        return [(x instanceof Date) ? Utilities.formatDate(x, CFG.TZ, 'HH:mm') : String(x)];
      });
      rp.getRange(2, c, out.length, 1).setNumberFormat('@').setValues(out);
    });
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

/** คืนค่าเป็นข้อความ HH:mm จากค่าเวลาใด ๆ */
function hhmmOf(v) {
  var p = parseHM(v);
  return p ? (('0' + p.h).slice(-2) + ':' + ('0' + p.m).slice(-2)) : '';
}

/**
 * ซ่อมชีต RoundPlan ที่คอลัมน์เลื่อน เพราะ flexEndTime เคยถูกต่อท้ายแล้ว setupSheets
 * เขียนหัวคอลัมน์ทับตามลำดับ SCHEMA — อ่านค่าตามลำดับเดิมแล้วเขียนกลับให้ตรงลำดับใหม่
 * มีตัวตรวจอาการในตัว รันซ้ำแล้วไม่พังซ้ำ
 */
function repairRoundPlan() {
  var sh = sheetOf('RoundPlan');
  var n = sh.getLastRow() - 1;
  if (n < 1) { Logger.log('RoundPlan ว่าง ไม่มีอะไรต้องซ่อม'); return 0; }
  var v = sh.getRange(2, 1, n, 8).getValues();

  // อาการคือคอลัมน์ที่ 5 (ตอนนี้ชื่อ flexEndTime) ยังเก็บตัวเลข graceEarlyMin อยู่
  var broken = v.every(function (r) {
    var x = String(r[4]).trim();
    return x !== '' && !isNaN(Number(x));
  });
  if (!broken) { Logger.log('RoundPlan เรียงถูกอยู่แล้ว ไม่ได้แก้อะไร'); return 0; }

  var out = v.map(function (r) {
    return [r[0], r[1], r[2], hhmmOf(r[3]), hhmmOf(r[7]), num(r[4], 15), num(r[5], 60), 'TRUE'];
  });
  sh.getRange(2, 1, n, 8).setNumberFormat('@').setValues(out);
  SpreadsheetApp.flush();
  Logger.log('ซ่อม RoundPlan แล้ว ' + n + ' แถว — รัน fixAndRebuild() ต่อ');
  return n;
}

/**
 * ตั้งสองรอบสุดท้ายของแต่ละประเภทวันให้เป็น "รอบยืดหยุ่น" ช่วง 00:00–06:00
 * วันทำการ = รอบ 5,6 · วันหยุด = รอบ 9,10 — รันซ้ำได้
 */
function setFlexRounds() {
  var target = { 'WORKDAY': [5, 6], 'HOLIDAY': [9, 10] };
  var n = 0;
  readTable('RoundPlan').forEach(function (p) {
    var list = target[String(p.dayType)] || [];
    if (list.indexOf(num(p.roundNo)) < 0) return;
    updateRow('RoundPlan', p._row, { schedTime: '00:00', flexEndTime: '06:00' });
    n++;
  });
  SpreadsheetApp.flush();
  Logger.log('ตั้งรอบยืดหยุ่นแล้ว ' + n + ' รอบ — รัน fixAndRebuild() ต่อเพื่อสร้างรอบใหม่');
  return n;
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

// ===========================================================================
//  ระบบแต้ม Office Love — ขั้นที่ 1 : คำนวณหลังบ้านอย่างเดียว
//  ยังไม่แสดงผลในแอป ดูตัวเลขได้ที่แท็บ Points ในชีต
//  หลักคิด: ให้แต้มกับงานที่ทำจริงและมีหลักฐานครบ ไม่ใช่จำนวนครั้งที่กด
// ===========================================================================

var PT = {
  SHIFT_IN      : 10,    // ลงเวลาเข้าเวรก่อนรอบแรกของวัน
  SHIFT_LATE    : 5,     // ลงเวลาเข้าเวรแต่ช้ากว่ารอบแรก
  SHIFT_OUT     : 5,     // ลงเวลาออกเวร
  CP            : 1,     // จุดตรวจที่ผ่านเกณฑ์
  ROUND         : 5,     // รอบที่ทำครบทุกจุด
  INCIDENT      : 15,    // รายงานเหตุผิดปกติ
  STATION       : 3,     // โบนัสรอบประจำจุดที่อยู่ครบเวลา (รวมเป็น 10 แต้ม/รอบ)
  FREE          : 1,     // ตรวจเพิ่มนอกรอบ ต่อจุด
  FREE_MAX      : 10,    // เพดานแต้มจากการตรวจเพิ่ม ต่อวัน
  FREE_GAP_MIN  : 10,    // จุดเดิมต้องเว้นกี่นาทีถึงนับแต้มอีกครั้ง
  PERFECT       : 20,    // ผลัดสมบูรณ์ — ทุกรอบของวันครบหมด
  NIGHT_MULT    : 1.5,   // ตัวคูณรอบกลางคืน (ก่อน 06:00)
  OVERRIDE_FREE : 3      // ยืนยันเองได้กี่ครั้งต่อเดือน โดยยังได้แต้มเต็ม
};

/** โบนัสเมื่อทำผลัดสมบูรณ์ติดต่อกันครบจำนวนนี้ (ครบ 30 แล้วให้ซ้ำทุก 30) */
var PT_STREAK = { 3: 50, 7: 150, 15: 400, 30: 1000 };

/** ค่าแต้มปรับได้จากแท็บ Config ด้วยคีย์ PT_XXX โดยไม่ต้องแก้โค้ด */
function ptCfg(k) { return num(cfgGet('PT_' + k, PT[k]), PT[k]); }

/** รอบกลางคืน = รอบที่เวลานัดอยู่ก่อน 06:00 */
function isNightRound(r) {
  var d = parseIso(r.schedAt);
  if (isNaN(d.getTime())) return false;
  return parseInt(fmt(d, 'HH'), 10) < CFG.DAY_START_HOUR;
}

/**
 * คำนวณแต้มใหม่ทั้งหมดแล้วเขียนทับแท็บ Points
 * ทำแบบสร้างใหม่ทั้งตารางเพื่อให้ผลลัพธ์คงที่ไม่ว่าจะรันกี่ครั้ง
 * การปรับแต้มด้วยมือให้บันทึกในแท็บ PointsAdjust ระบบจะรวมให้เอง (ไม่มีการหักแต้มเงียบ ๆ)
 */
function rebuildPoints() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'ระบบกำลังทำงานอื่นอยู่ ลองใหม่อีกครั้ง';
  try {
    var rounds   = readTable('Rounds');
    var checkins = readTable('Checkins');
    var shifts   = readTable('Shifts');
    var incs     = readTable('Incidents');
    var adjusts  = readTable('PointsAdjust');

    var byRound = {};
    rounds.forEach(function (r) { byRound[String(r.roundId)] = r; });

    // สรุปของแต่ละวัน แยกตามคน — คีย์ workDate|userId
    var day = {};
    function slot(wd, uid2, name) {
      var k = wd + '|' + uid2;
      if (!day[k]) day[k] = {
        workDate: wd, userId: uid2, userName: name || '',
        shiftPts: 0, cpPts: 0, roundPts: 0, nightBonus: 0, outPts: 0, incPts: 0,
        perfectBonus: 0, streakBonus: 0, adjust: 0, total: 0,
        roundsDone: 0, roundsTotal: 0, nightRounds: 0, cpOk: 0, cpOverride: 0, cpNoGps: 0,
        freeChecks: 0, freeOk: 0, freePts: 0,
        incidents: 0, perfect: '', streak: 0, freeze: false, note: ''
      };
      if (name && !day[k].userName) day[k].userName = name;
      return day[k];
    }

    // ---- จุดตรวจ -----------------------------------------------------------
    // เรียงตามเวลาก่อน เพื่อให้เพดาน "ยืนยันเอง 3 ครั้งแรกของเดือน" นับตามลำดับจริง
    checkins.sort(function (a, b) {
      var x = String(a.ts), y = String(b.ts);
      return x < y ? -1 : (x > y ? 1 : 0);
    });

    var ovUsed = {};     // เดือน|userId -> จำนวนครั้งที่ยืนยันเองไปแล้ว
    var roundAgg = {};   // roundId|userId -> แต้มจุดตรวจที่ได้ในรอบนั้น
    var freeLast = {};   // userId|cpId -> เวลาที่นับแต้มตรวจเพิ่มครั้งล่าสุด

    checkins.forEach(function (c) {
      var r = byRound[String(c.roundId)];
      if (!r) return;
      var wd = dstr(r.workDate), u = String(c.userId);
      var s  = slot(wd, u, String(c.userName || ''));
      var v  = String(c.verifyResult || '');
      var give = 0;

      if (v === 'PASS' || v === 'WARN_ACCURACY') {
        give = 1; s.cpOk++;
      } else if (v === 'OVERRIDE') {
        s.cpOverride++;
        if (String(r.mode || '').toUpperCase() === 'STATION') {
          give = 1;                                  // จุดในอาคาร ไม่นับเข้าเพดาน
        } else {
          var mk = monthOf(wd) + '|' + u;
          ovUsed[mk] = (ovUsed[mk] || 0) + 1;
          // ยืนยันเองโดยมีเหตุผลตามจริง = ได้แต้มเต็ม แต่จำกัดจำนวนครั้งต่อเดือน
          give = (ovUsed[mk] <= ptCfg('OVERRIDE_FREE')) ? 1 : 0;
        }
      } else {
        s.cpNoGps++;
      }
      // ตรวจเพิ่มนอกรอบ — นับแยก มีเพดานและต้องเว้นระยะจุดเดิม
      if (String(r.mode || '').toUpperCase() === 'FREE') {
        s.freeChecks++;
        var fk = u + '|' + String(c.cpId), tms = parseIso(c.ts).getTime();
        var gap = ptCfg('FREE_GAP_MIN') * 60000;
        if (give && (!freeLast[fk] || (tms - freeLast[fk]) >= gap)) {
          freeLast[fk] = tms;
          s.freeOk++;
        }
        return;
      }
      if (!give) return;

      var rk = String(c.roundId) + '|' + u;
      if (!roundAgg[rk]) roundAgg[rk] = { cp: 0, wd: wd, uid: u, round: r };
      roundAgg[rk].cp += give;
    });

    Object.keys(day).forEach(function (k) {
      var s2 = day[k];
      s2.freePts = Math.min(s2.freeOk * ptCfg('FREE'), ptCfg('FREE_MAX'));
    });

    // ---- รวมเป็นรายรอบ แล้วคูณตัวคูณกลางคืน --------------------------------
    var userFirst = {};   // workDate|userId -> เวลานัดของรอบแรกที่คนนั้นทำจริง
    Object.keys(roundAgg).forEach(function (rk) {
      var a = roundAgg[rk], r = a.round, s = slot(a.wd, a.uid);
      var tm = parseIso(r.schedAt).getTime();
      if (!isNaN(tm)) {
        var uk = a.wd + '|' + a.uid;
        if (userFirst[uk] === undefined || tm < userFirst[uk]) userFirst[uk] = tm;
      }
      var base  = a.cp * ptCfg('CP');
      var bonus = (String(r.status) === 'COMPLETE') ? ptCfg('ROUND') : 0;
      if (bonus) {
        s.roundsDone++;
        if (String(r.mode || '').toUpperCase() === 'STATION') bonus += ptCfg('STATION');
      }
      var night = isNightRound(r);
      if (night) s.nightRounds++;
      var extra = night ? Math.round((base + bonus) * (ptCfg('NIGHT_MULT') - 1)) : 0;
      s.cpPts      += base;
      s.roundPts   += bonus;
      s.nightBonus += extra;
    });

    // ---- เข้า–ออกเวร -------------------------------------------------------
    var firstSched = {};
    rounds.forEach(function (r) {
      var wd = dstr(r.workDate), tm = parseIso(r.schedAt).getTime();
      if (isNaN(tm)) return;
      if (firstSched[wd] === undefined || tm < firstSched[wd]) firstSched[wd] = tm;
    });

    shifts.forEach(function (sf) {
      if (!sf.checkInAt) return;
      var wd = dstr(sf.workDate), u = String(sf.guardUserId);
      var s  = slot(wd, u, String(sf.guardName || ''));
      var inT = parseIso(sf.checkInAt).getTime();
      if (sf.planId) {
        // มีตารางกะแล้ว — ตัดสินจากเวลากะที่ตั้งไว้ตอนเข้าเวร
        s.shiftPts = String(sf.onTime || '') ? ptCfg('SHIFT_IN') : ptCfg('SHIFT_LATE');
      } else {
        // ข้อมูลเก่าก่อนมีตารางกะ — เทียบกับรอบแรกที่ตัวเองรับผิดชอบ
        var lim = userFirst[wd + '|' + u];
        if (lim === undefined) lim = firstSched[wd];
        s.shiftPts = (lim === undefined || isNaN(inT) || inT <= lim)
                   ? ptCfg('SHIFT_IN') : ptCfg('SHIFT_LATE');
      }
      // ออกเวรฉุกเฉินโดยไม่มีผู้รับเวร ไม่ได้แต้มออกเวร
      if (sf.checkOutAt && !bool(sf.emergency)) s.outPts = ptCfg('SHIFT_OUT');
      // พิมพ์คำว่า "ยกเว้น" ไว้ในช่อง note ของแท็บ Shifts = วันนั้นไม่ตัด streak
      if (String(sf.note || '').indexOf('ยกเว้น') >= 0) { s.freeze = true; s.note = 'ยกเว้นตามข้อ 8'; }
    });

    // ---- เหตุผิดปกติ -------------------------------------------------------
    incs.forEach(function (x) {
      var r  = byRound[String(x.roundId)];
      var wd = r ? dstr(r.workDate) : workDateOf(parseIso(x.ts));
      var s  = slot(wd, String(x.userId), String(x.userName || ''));
      s.incidents++;
      s.incPts += ptCfg('INCIDENT');
    });

    // ---- ปรับแต้มด้วยมือ ---------------------------------------------------
    adjusts.forEach(function (a) {
      var wd = dstr(a.workDate), u = String(a.userId);
      if (!wd || !u) return;
      var s = slot(wd, u);
      s.adjust += num(a.delta);
      var why = String(a.reason || '');
      if (why) s.note = s.note ? (s.note + ' | ' + why) : why;
    });

    // ---- ผลัดสมบูรณ์ -------------------------------------------------------
    var dayRounds = {};
    rounds.forEach(function (r) {
      if (String(r.mode || '').toUpperCase() === 'FREE') return;   // รอบอิสระไม่นับรวม
      var wd = dstr(r.workDate);
      if (!dayRounds[wd]) dayRounds[wd] = { total: 0, done: 0 };
      dayRounds[wd].total++;
      if (String(r.status) === 'COMPLETE') dayRounds[wd].done++;
    });

    var keys = Object.keys(day).sort();
    var byUser = {};
    keys.forEach(function (k) {
      var s  = day[k];
      var dr = dayRounds[s.workDate] || { total: 0, done: 0 };
      s.roundsTotal = dr.total;
      s.perfect = (dr.total > 0 && dr.done === dr.total && s.roundsDone > 0) ? 'TRUE' : '';
      if (s.perfect) s.perfectBonus = ptCfg('PERFECT');
      (byUser[s.userId] = byUser[s.userId] || []).push(s);
    });

    // ---- โบนัสต่อเนื่อง ----------------------------------------------------
    Object.keys(byUser).forEach(function (u) {
      var arr = byUser[u].sort(function (a, b) {
        return a.workDate < b.workDate ? -1 : (a.workDate > b.workDate ? 1 : 0);
      });
      var run = 0;
      arr.forEach(function (s) {
        if (s.freeze) { s.streak = run; return; }        // แช่แข็ง: ไม่นับเพิ่ม และไม่ตัดของเดิม
        if (s.perfect) {
          run++;
          if (PT_STREAK[run]) s.streakBonus = PT_STREAK[run];
          else if (run > 30 && run % 30 === 0) s.streakBonus = PT_STREAK[30];
        } else {
          run = 0;
        }
        s.streak = run;
      });
    });

    // ---- เขียนลงแท็บ Points ------------------------------------------------
    var now = nowIso();
    var out = keys.map(function (k) {
      var s = day[k];
      s.total = s.shiftPts + s.cpPts + s.roundPts + s.nightBonus + s.outPts +
                s.incPts + s.perfectBonus + s.streakBonus + s.freePts + s.adjust;
      s.calcAt = now;
      return s;
    });

    var sh = sheetOf('Points');
    // Points เป็นตารางที่สร้างใหม่ทุกครั้งอยู่แล้ว จึงเขียนหัวคอลัมน์ตาม SCHEMA ทับได้เสมอ
    sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), SCHEMA.Points.length)).clearContent();
    sh.getRange(1, 1, 1, SCHEMA.Points.length).setValues([SCHEMA.Points]);
    var head = SCHEMA.Points.slice();
    if (sh.getLastRow() > 1)
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (out.length) {
      var rowsOut = out.map(function (s) {
        return head.map(function (h) { return (s[h] === undefined || s[h] === null) ? '' : s[h]; });
      });
      sh.getRange(2, 1, rowsOut.length, head.length).setValues(rowsOut);
    }
    SpreadsheetApp.flush();
    return 'คำนวณแต้มแล้ว ' + out.length + ' แถว';
  } finally { lock.releaseLock(); }
}

/** สรุปแต้มรายเดือนออกทาง Logger — ใช้ดูด้วยตาว่าตัวเลขสมเหตุสมผลไหม */
function pointsSummary() {
  var rows = readTable('Points');
  var agg = {};
  rows.forEach(function (r) {
    var k = monthOf(dstr(r.workDate)) + ' | ' + (r.userName || r.userId);
    if (!agg[k]) agg[k] = { days: 0, total: 0, perfect: 0, ov: 0, inc: 0, best: 0 };
    agg[k].days++;
    agg[k].total   += num(r.total);
    agg[k].perfect += r.perfect ? 1 : 0;
    agg[k].ov      += num(r.cpOverride);
    agg[k].inc     += num(r.incidents);
    agg[k].best     = Math.max(agg[k].best, num(r.streak));
  });
  var lines = Object.keys(agg).sort().map(function (k) {
    var a = agg[k];
    return k + '  —  ' + a.total + ' แต้ม / ' + a.days + ' วัน' +
           '  (เฉลี่ย ' + Math.round(a.total / a.days) + ' ต่อวัน)' +
           '  ผลัดสมบูรณ์ ' + a.perfect + '  streak สูงสุด ' + a.best +
           '  ยืนยันเอง ' + a.ov + '  รายงานเหตุ ' + a.inc;
  });
  var txt = lines.length ? lines.join('\n') : 'ยังไม่มีข้อมูลแต้ม';
  Logger.log(txt);
  return txt;
}

/** ปรับแต้มด้วยมือพร้อมเหตุผล — รันจาก Editor แก้ค่าในบรรทัดแรกก่อนรัน */
function addPointsAdjust() {
  var workDate = '2026-09-21';
  var userId   = 'guard01';
  var delta    = -50;
  var reason   = 'ระบุเหตุผลตรงนี้';

  appendRow('PointsAdjust', {
    adjId: uid(), ts: nowIso(), workDate: workDate, userId: userId,
    delta: delta, reason: reason, by: 'ADMIN'
  });
  return rebuildPoints();
}

// ===========================================================================
//  ระบบแต้ม — ขั้นที่ 2 : ข้อมูลสำหรับแสดงในแอป
//  วันที่ผ่านมาอ่านจากแท็บ Points ที่ rebuildPoints คำนวณไว้ ส่วนวันนี้คิดสด
// ===========================================================================

// ระดับ — อิงจากอัตราจริง ~2,500 แต้ม/คน/เดือน ไต่ถึงระดับสูงสุดพอดีครบ 1 ปีสัญญา
var PT_LEVELS = [
  { min: 0,     name: 'ยามใหม่' },        // เริ่มต้น
  { min: 2800,  name: 'ยามชำนาญ' },       // ~1 เดือน
  { min: 9000,  name: 'ยามอาวุโส' },      // ~3 เดือน
  { min: 20000, name: 'ยามผู้พิทักษ์' },  // ~7 เดือน
  { min: 34000, name: 'ยามตำนาน' }        // ~12 เดือน
];

function levelOf(total) {
  var i = 0;
  for (var k = 0; k < PT_LEVELS.length; k++) if (total >= PT_LEVELS[k].min) i = k;
  return { level: i + 1, name: PT_LEVELS[i].name, min: PT_LEVELS[i].min,
           next: (i + 1 < PT_LEVELS.length) ? PT_LEVELS[i + 1].min : 0 };
}

function prevMonth(mk) {
  var y = parseInt(mk.substring(0, 4), 10), m = parseInt(mk.substring(5, 7), 10) - 1;
  if (m < 1) { m = 12; y--; }
  return y + '-' + ('0' + m).slice(-2);
}

/** เป้าแต้มรายเดือน = ของเดือนก่อน +5% มีพื้นและเพดานกันสูงหรือต่ำเกินไป */
function monthGoal(rows, mk) {
  var prev = prevMonth(mk), sum = 0, n = 0;
  rows.forEach(function (r) {
    if (monthOf(dstr(r.workDate)) === prev) { sum += num(r.total); n++; }
  });
  var floorV = num(cfgGet('PT_GOAL_MIN', 2700), 2700);
  var capV   = num(cfgGet('PT_GOAL_MAX', 7000), 7000);
  var base   = n ? Math.round(sum * 1.05) : floorV;
  return Math.max(floorV, Math.min(capV, base));
}

/** คิดแต้มของวันนี้แบบสด ใช้กติกาเดียวกับ rebuildPoints */
function ptCtx() {
  return { rounds: readTable('Rounds'), checkins: readTable('Checkins'),
           shifts: readTable('Shifts'), incidents: readTable('Incidents') };
}

function dayPointsLive(userId, workDate, prevStreak, ovBefore, ctx) {
  ctx = ctx || ptCtx();
  var rounds = ctx.rounds.filter(function (r) { return dstr(r.workDate) === workDate; });
  var mine = {};
  rounds.forEach(function (r) { mine[String(r.roundId)] = r; });

  var sched = rounds.filter(function (r) { return String(r.mode || '').toUpperCase() !== 'FREE'; });
  var s = { shiftPts: 0, cpPts: 0, roundPts: 0, nightBonus: 0, outPts: 0, incPts: 0,
            perfectBonus: 0, streakBonus: 0, freeChecks: 0, freeOk: 0, freePts: 0, total: 0,
            roundsDone: 0, roundsTotal: sched.length, nightRounds: 0, cpOk: 0, cpOverride: 0,
            incidents: 0, perfect: false, streak: num(prevStreak) };

  var agg = {}, ov = num(ovBefore), freeLast = {};
  ctx.checkins.forEach(function (c) {
    if (String(c.userId) !== userId) return;
    if (!mine[String(c.roundId)]) return;
    var v = String(c.verifyResult || ''), give = 0;
    if (v === 'PASS' || v === 'WARN_ACCURACY') { give = 1; s.cpOk++; }
    else if (v === 'OVERRIDE') {
      s.cpOverride++;
      if (String(mine[String(c.roundId)].mode || '').toUpperCase() === 'STATION') give = 1;
      else { ov++; give = (ov <= ptCfg('OVERRIDE_FREE')) ? 1 : 0; }
    }
    if (String(mine[String(c.roundId)].mode || '').toUpperCase() === 'FREE') {
      s.freeChecks++;
      var fk = String(c.cpId), tms = parseIso(c.ts).getTime();
      if (give && (!freeLast[fk] || (tms - freeLast[fk]) >= ptCfg('FREE_GAP_MIN') * 60000)) {
        freeLast[fk] = tms; s.freeOk++;
      }
      return;
    }
    if (give) agg[String(c.roundId)] = (agg[String(c.roundId)] || 0) + give;
  });

  var userFirst = 0;
  Object.keys(agg).forEach(function (rid) {
    var r = mine[rid];
    var tm0 = parseIso(r.schedAt).getTime();
    if (!isNaN(tm0) && (!userFirst || tm0 < userFirst)) userFirst = tm0;
    var base  = agg[rid] * ptCfg('CP');
    var bonus = (String(r.status) === 'COMPLETE') ? ptCfg('ROUND') : 0;
    if (bonus) {
      s.roundsDone++;
      if (String(r.mode || '').toUpperCase() === 'STATION') bonus += ptCfg('STATION');
    }
    s.cpPts    += base;
    s.roundPts += bonus;
    if (isNightRound(r)) {
      s.nightRounds++;
      s.nightBonus += Math.round((base + bonus) * (ptCfg('NIGHT_MULT') - 1));
    }
  });

  s.freePts = Math.min(s.freeOk * ptCfg('FREE'), ptCfg('FREE_MAX'));

  var firstSched = 0;
  sched.forEach(function (r) {
    var t = parseIso(r.schedAt).getTime();
    if (!isNaN(t) && (!firstSched || t < firstSched)) firstSched = t;
  });

  var freeze = false;
  ctx.shifts.forEach(function (sf) {
    if (String(sf.guardUserId) !== userId || dstr(sf.workDate) !== workDate) return;
    if (!sf.checkInAt) return;
    var inT = parseIso(sf.checkInAt).getTime();
    if (sf.planId) {
      s.shiftPts = String(sf.onTime || '') ? ptCfg('SHIFT_IN') : ptCfg('SHIFT_LATE');
    } else {
      var lim = userFirst || firstSched;
      s.shiftPts = (!lim || isNaN(inT) || inT <= lim)
                 ? ptCfg('SHIFT_IN') : ptCfg('SHIFT_LATE');
    }
    if (sf.checkOutAt && !bool(sf.emergency)) s.outPts = ptCfg('SHIFT_OUT');
    if (String(sf.note || '').indexOf('ยกเว้น') >= 0) freeze = true;
  });

  ctx.incidents.forEach(function (x) {
    if (String(x.userId) !== userId) return;
    var r  = mine[String(x.roundId)];
    var wd = r ? workDate : workDateOf(parseIso(x.ts));
    if (wd !== workDate) return;
    s.incidents++;
    s.incPts += ptCfg('INCIDENT');
  });

  var allDone = sched.length > 0 && sched.every(function (r) { return String(r.status) === 'COMPLETE'; });
  s.perfect = !!(allDone && s.roundsDone > 0);
  if (s.perfect) {
    s.perfectBonus = ptCfg('PERFECT');
    if (!freeze) {
      s.streak = num(prevStreak) + 1;
      if (PT_STREAK[s.streak]) s.streakBonus = PT_STREAK[s.streak];
      else if (s.streak > 30 && s.streak % 30 === 0) s.streakBonus = PT_STREAK[30];
    }
  } else if (!freeze) {
    s.streak = 0;
  }

  s.total = s.shiftPts + s.cpPts + s.roundPts + s.nightBonus + s.outPts +
            s.incPts + s.perfectBonus + s.streakBonus + s.freePts;
  return s;
}

// ===========================================================================
//  ระบบแต้ม — ขั้นที่ 3 : เหรียญตรา เป้าทีม ร้านแลกแต้ม และสรุปรายสัปดาห์
// ===========================================================================

var PT_BADGES = [
  { id: 'night',  icon: '🌙', name: 'นักรบราตรี',            need: 30,  unit: 'รอบกลางคืน',
    how: 'เดินตรวจรอบกลางคืน (ก่อน 06:00) ครบ 30 รอบ' },
  { id: 'exact',  icon: '🎯', name: 'แม่นเป๊ะ',              need: 100, unit: 'จุด',
    how: 'บันทึกจุดตรวจติดต่อกัน 100 จุด โดยไม่ต้องใช้การยืนยันด้วยตนเอง' },
  { id: 'eye',    icon: '📸', name: 'ตาไว',                  need: 10,  unit: 'ครั้ง',
    how: 'รายงานเหตุผิดปกติพร้อมภาพครบ 10 ครั้ง' },
  { id: 'ontime', icon: '⏱',  name: 'ตรงเวลา',               need: 20,  unit: 'ผลัด',
    how: 'ลงเวลาเข้าเวรตรงเวลาติดต่อกัน 20 ผลัด' },
  { id: 'iron',   icon: '🛡',  name: 'ยามเหล็ก',              need: 100, unit: 'ผลัด',
    how: 'ทำผลัดสมบูรณ์ครบ 100 ผลัด' },
  { id: 'star',   icon: '🥇', name: 'ยอดเยี่ยมประจำเดือน',   need: 1,   unit: 'เดือน',
    how: 'ทำแต้มถึงเป้าของเดือนนั้น' }
];

/** คำนวณความคืบหน้าของเหรียญตราจากแถวใน Points (เรียงตามวันแล้ว) */
function badgesOf(rows) {
  var night = 0, eye = 0, iron = 0;
  var exactRun = 0, exactBest = 0, onRun = 0, onBest = 0;
  var months = {};

  rows.forEach(function (r) {
    night += num(r.nightRounds);
    eye   += num(r.incidents);
    if (r.perfect) iron++;

    if (num(r.cpOverride) > 0) exactRun = 0;
    else exactRun += num(r.cpOk);
    if (exactRun > exactBest) exactBest = exactRun;

    if (num(r.shiftPts) >= ptCfg('SHIFT_IN')) onRun++;
    else if (num(r.shiftPts) > 0) onRun = 0;
    if (onRun > onBest) onBest = onRun;

    var mk = monthOf(dstr(r.workDate));
    months[mk] = (months[mk] || 0) + num(r.total);
  });

  var floorV = num(cfgGet('PT_GOAL_MIN', 2700), 2700);
  var star = 0;
  Object.keys(months).forEach(function (mk) { if (months[mk] >= floorV) star++; });

  var have = { night: night, exact: exactBest, eye: eye, ontime: onBest, iron: iron, star: star };
  return PT_BADGES.map(function (b) {
    var got = Math.min(have[b.id], b.need);
    return { id: b.id, icon: b.icon, name: b.name, how: b.how, unit: b.unit,
             need: b.need, have: have[b.id], got: got,
             done: have[b.id] >= b.need,
             pct: Math.min(100, Math.round(have[b.id] * 100 / b.need)) };
  });
}

/** แถวแต้มของผู้ใช้คนหนึ่ง เรียงตามวัน พร้อมแถวของวันนี้ที่คิดสด */
function pointsRowsOf(userId) {
  var workDate = workDateOf(new Date());
  var mk = monthOf(workDate);
  var all = readTable('Points');

  var mine = [], teamMonth = 0, prevStreak = 0, prevDate = '', ovBefore = 0;
  all.forEach(function (r) {
    var wd = dstr(r.workDate);
    if (monthOf(wd) === mk && wd !== workDate) teamMonth += num(r.total);
    if (String(r.userId) !== userId) return;
    if (wd === workDate) return;
    mine.push(r);
    if (monthOf(wd) === mk) ovBefore += num(r.cpOverride);
    if (wd > prevDate) { prevDate = wd; prevStreak = num(r.streak); }
  });
  mine.sort(function (a, b) {
    var x = dstr(a.workDate), y = dstr(b.workDate);
    return x < y ? -1 : (x > y ? 1 : 0);
  });

  var ctx = ptCtx();
  var t = dayPointsLive(userId, workDate, prevStreak, ovBefore, ctx);

  // แต้มที่ปรับด้วยมือหรือใช้แลกของวันนี้ ยังไม่ถูกรวมโดย rebuildPoints
  var adjToday = 0;
  readTable('PointsAdjust').forEach(function (a) {
    if (String(a.userId) === userId && dstr(a.workDate) === workDate) adjToday += num(a.delta);
  });

  var today = {
    workDate: workDate, userId: userId, total: t.total + adjToday, adjust: adjToday,
    shiftPts: t.shiftPts, cpPts: t.cpPts, roundPts: t.roundPts, nightBonus: t.nightBonus,
    outPts: t.outPts, incPts: t.incPts, perfectBonus: t.perfectBonus, streakBonus: t.streakBonus,
    roundsDone: t.roundsDone, roundsTotal: t.roundsTotal, nightRounds: t.nightRounds,
    cpOk: t.cpOk, cpOverride: t.cpOverride, incidents: t.incidents,
    freeChecks: t.freeChecks, freePts: t.freePts,
    perfect: t.perfect ? 'TRUE' : '', streak: t.streak
  };

  // แต้มทีมของเดือนนี้ = ทุกคนรวมกัน (รวมของวันนี้ด้วย)
  var todayAll = 0;
  staffList().forEach(function (u) {
    if (String(u.userId) === userId) { todayAll += today.total; return; }
    if (String(u.role) !== 'GUARD') return;
    var others = dayPointsLive(String(u.userId), workDate, 0, 0, ctx);
    todayAll += others.total;
  });

  return { workDate: workDate, mk: mk, rows: mine.concat([today]), past: mine, today: today,
           teamMonth: teamMonth + todayAll };
}

function ptSummary(userId) {
  var d = pointsRowsOf(userId);
  var career = 0, balance = 0, month = 0;
  d.rows.forEach(function (r) {
    var adj = num(r.adjust);
    career  += num(r.total) - Math.min(0, adj);   // แต้มที่หามาได้ ไม่ลดเมื่อนำไปแลกของ
    balance += num(r.total);
    if (monthOf(dstr(r.workDate)) === d.mk) month += num(r.total);
  });

  var lv = levelOf(career);
  var badges = badgesOf(d.rows);
  var got = 0;
  badges.forEach(function (b) { if (b.done) got++; });

  return {
    data: d, badges: badges,
    points: {
      workDate: d.workDate, today: num(d.today.total), month: month,
      career: career, balance: balance, lifetime: career,
      goal: monthGoal(d.past, d.mk),
      teamMonth: d.teamMonth, teamGoal: num(cfgGet('PT_TEAM_GOAL', 5600), 5600),
      streak: num(d.today.streak), perfect: !!d.today.perfect,
      level: lv.level, levelName: lv.name, levelMin: lv.min, levelNext: lv.next,
      roundsDone: num(d.today.roundsDone), roundsTotal: num(d.today.roundsTotal),
      incidents: num(d.today.incidents), cpOverride: num(d.today.cpOverride),
      freeChecks: num(d.today.freeChecks), freePts: num(d.today.freePts),
      badgesGot: got, badgesTotal: PT_BADGES.length,
      breakdown: { shift: num(d.today.shiftPts), cp: num(d.today.cpPts),
                   round: num(d.today.roundPts), night: num(d.today.nightBonus),
                   out: num(d.today.outPts), incident: num(d.today.incPts),
                   perfect: num(d.today.perfectBonus), streak: num(d.today.streakBonus),
                   free: num(d.today.freePts), adjust: num(d.today.adjust) }
    }
  };
}

/**
 * ร้านแลกแต้ม — ราคาอิงมูลค่าจริงที่อัตรา 25 แต้ม = 1 บาท
 * รปภ. ทำได้ราว 2,500 แต้ม/คน/เดือน จึงคิดเป็นงบประมาณ 100 บาท/คน/เดือน
 * แก้ราคาในชีตได้ตามใจ ถ้าอยากให้โค้ดเขียนทับใหม่ทั้งชุด ให้เพิ่มเลข REWARD_CATALOG_VER
 */
var REWARD_CATALOG_VER = 3;
var REWARD_CATALOG = [
  ['ขนม / ของว่าง',                       550,   'มูลค่าราว 20 บาท'],
  ['กาแฟ / น้ำเย็น 1 แก้ว',                700,   'มูลค่าราว 25 บาท'],
  ['ข้าวกล่องพิเศษ 1 มื้อ',                1700,  'มูลค่าราว 60 บาท'],
  ['บัตรเติมเงินมือถือ 100 บาท',           2800,  'มูลค่า 100 บาท'],
  ['ใบประกาศเกียรติคุณจากผู้จัดการ',       3400,  'ไม่ใช้งบ แต่เป็นเกียรติ สำเนาแจ้ง อผศ.'],
  ['ของใช้ประจำตัว — ไฟฉาย ถุงมือ',        4200,  'มูลค่าราว 150 บาท'],
  ['เสื้อ / รองเท้าสำหรับปฏิบัติงาน',      9800,  'มูลค่าราว 350 บาท'],
  ['ของรางวัลใหญ่ประจำปี',                 14000, 'มูลค่าราว 500 บาท']
];

function cfgSet(key, value, note) {
  var rows = readTable('Config');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].key) === String(key)) {
      updateRow('Config', rows[i]._row, { value: value });
      return;
    }
  }
  appendRow('Config', { key: String(key), value: value, note: String(note || '') });
}

function seedRewards() {
  var rows = readTable('Rewards');
  if (rows.length && num(cfgGet('REWARD_CATALOG_VER', 0)) >= REWARD_CATALOG_VER) return rows;

  var sh = sheetOf('Rewards');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  REWARD_CATALOG.forEach(function (x) {
    appendRow('Rewards', { rewardId: uid(), name: x[0], cost: x[1], stock: '',
                           note: x[2], active: 'TRUE' });
  });
  cfgSet('REWARD_CATALOG_VER', REWARD_CATALOG_VER,
         'รุ่นของรายการในร้านแลกแต้ม — เพิ่มเลขนี้ในโค้ดเมื่อต้องการเขียนราคาใหม่ทับทั้งชุด');
  SpreadsheetApp.flush();
  return readTable('Rewards');
}

function apiPtBoard(me) {
  var s = ptSummary(me.userId);
  var rewards = seedRewards().filter(function (r) { return bool(r.active); })
    .sort(function (a, b) { return num(a.cost) - num(b.cost); })
    .map(function (r) {
      return { rewardId: String(r.rewardId), name: String(r.name), cost: num(r.cost),
               note: String(r.note || '') };
    });

  var mine = readTable('Redemptions')
    .filter(function (r) { return String(r.userId) === me.userId; })
    .sort(function (a, b) { return String(b.ts) < String(a.ts) ? -1 : 1; })
    .slice(0, 20)
    .map(function (r) {
      return { redId: String(r.redId), ts: String(r.ts), name: String(r.rewardName),
               cost: num(r.cost), status: String(r.status || 'REQUESTED') };
    });

  var hist = s.data.rows.slice(-14).reverse().map(function (r) {
    return { workDate: dstr(r.workDate), total: num(r.total), perfect: !!r.perfect,
             streak: num(r.streak), roundsDone: num(r.roundsDone), roundsTotal: num(r.roundsTotal) };
  });

  return ok({ points: s.points, badges: s.badges, rewards: rewards,
              redemptions: mine, history: hist });
}

function apiMyPoints(me) {
  return ok({ points: ptSummary(me.userId).points });
}

function apiRedeem(me, req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return err('ระบบกำลังบันทึกรายการอื่น ลองใหม่อีกครั้ง');
  try {
    var id = String(req.rewardId || '');
    var rw = null;
    seedRewards().forEach(function (r) { if (String(r.rewardId) === id && bool(r.active)) rw = r; });
    if (!rw) return err('ไม่พบของรางวัลนี้');

    var cost = num(rw.cost);
    var bal  = ptSummary(me.userId).points.balance;
    if (bal < cost) return err('แต้มไม่พอ — มี ' + bal + ' แต้ม ต้องใช้ ' + cost + ' แต้ม');

    var workDate = workDateOf(new Date());
    var redId = uid();
    appendRow('Redemptions', {
      redId: redId, ts: nowIso(), workDate: workDate, userId: me.userId, userName: me.name,
      rewardId: String(rw.rewardId), rewardName: String(rw.name), cost: cost,
      status: 'REQUESTED', handledBy: '', handledAt: '', note: ''
    });
    appendRow('PointsAdjust', {
      adjId: uid(), ts: nowIso(), workDate: workDate, userId: me.userId,
      delta: -cost, reason: 'แลกของรางวัล: ' + rw.name, by: me.userId
    });
    audit(me.userId, 'REDEEM', 'REWARD', redId, null, { name: String(rw.name), cost: cost });
    notifySupervisor(me.name + ' แลกของรางวัล: ' + rw.name + ' (' + cost + ' แต้ม)', 'LOW');

    return ok({ redId: redId, balance: bal - cost, name: String(rw.name), cost: cost });
  } finally { lock.releaseLock(); }
}

/** หัวหน้าเวร/แอดมิน กดยืนยันว่าส่งมอบของรางวัลแล้ว หรือยกเลิกและคืนแต้ม */
function apiRedeemUpdate(me, req) {
  var id = String(req.redId || ''), st = String(req.status || '').toUpperCase();
  if (['GIVEN', 'CANCELLED'].indexOf(st) < 0) return err('สถานะไม่ถูกต้อง');

  var rows = readTable('Redemptions'), hit = null;
  rows.forEach(function (r) { if (String(r.redId) === id) hit = r; });
  if (!hit) return err('ไม่พบรายการแลกของรางวัล');
  if (String(hit.status) !== 'REQUESTED') return err('รายการนี้ดำเนินการไปแล้ว');

  updateRow('Redemptions', hit._row, {
    status: st, handledBy: me.userId, handledAt: nowIso(),
    note: String(req.note || hit.note || '')
  });

  if (st === 'CANCELLED') {
    appendRow('PointsAdjust', {
      adjId: uid(), ts: nowIso(), workDate: dstr(hit.workDate), userId: String(hit.userId),
      delta: num(hit.cost), reason: 'ยกเลิกการแลก: ' + hit.rewardName, by: me.userId
    });
  }
  audit(me.userId, 'REDEEM_' + st, 'REWARD', id, null, null);
  return ok({ redId: id, status: st });
}

/** สรุปแต้มรายสัปดาห์ส่งเข้าห้องแชท — trigger ทุกวันจันทร์ 08:00 */
function weeklyPointsDigest() {
  if (String(cfgGet('NOTIFY_CHANNEL', 'WEBEX')).toUpperCase() === 'OFF') return '';
  var since = fmt(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd');
  var agg = {};
  readTable('Points').forEach(function (r) {
    if (dstr(r.workDate) < since) return;
    var k = String(r.userName || r.userId);
    if (!agg[k]) agg[k] = { total: 0, perfect: 0, inc: 0, streak: 0 };
    agg[k].total   += num(r.total);
    agg[k].perfect += r.perfect ? 1 : 0;
    agg[k].inc     += num(r.incidents);
    agg[k].streak   = Math.max(agg[k].streak, num(r.streak));
  });
  var names = Object.keys(agg);
  if (!names.length) return '';

  var lines = ['🏅 สรุปแต้ม 7 วันที่ผ่านมา'];
  names.sort().forEach(function (k) {
    var a = agg[k];
    lines.push('• ' + k + ' — ' + a.total + ' แต้ม · ผลัดสมบูรณ์ ' + a.perfect +
               ' · รายงานเหตุ ' + a.inc + (a.streak > 1 ? ' · 🔥 ต่อเนื่อง ' + a.streak : ''));
  });
  lines.push('ขอบคุณทุกคนที่ดูแลสำนักงานตลอดสัปดาห์ครับ');
  var txt = lines.join('\n');
  notify(txt, 'LOW', 'POINTS_WEEKLY', '', 'GUARD');
  return txt;
}

// ===========================================================================
//  ตารางกะ · การต่อเวร · รอบตรวจเพิ่มนอกรอบ
// ===========================================================================

var SHIFTPLAN_VER = 1;
var SHIFTPLAN_SEED = [
  // name, start, end, graceEarly, lateAfter, handover, requireHandover
  ['กะกลางวัน',  '08:00', '18:00', 15, 15, 15, 'TRUE'],
  ['กะกลางคืน',  '18:00', '08:00', 15, 15, 15, 'TRUE']
];

function seedShiftPlan() {
  ensureRoundCols();
  var rows = readTable('ShiftPlan');
  if (rows.length && num(cfgGet('SHIFTPLAN_VER', 0)) >= SHIFTPLAN_VER) return rows;
  if (!rows.length) {
    SHIFTPLAN_SEED.forEach(function (x) {
      appendRow('ShiftPlan', {
        planId: uid(), name: x[0], startTime: x[1], endTime: x[2],
        graceEarlyMin: x[3], lateAfterMin: x[4], handoverMin: x[5],
        requireHandover: x[6], active: 'TRUE', note: ''
      });
    });
  }
  cfgSet('SHIFTPLAN_VER', SHIFTPLAN_VER,
         'รุ่นของตารางกะ — แก้เวลาในแท็บ ShiftPlan ได้ตามใจ ระบบจะไม่เขียนทับอีก');
  SpreadsheetApp.flush();
  return readTable('ShiftPlan');
}

/** ช่วงเวลาจริงของกะหนึ่ง ในวันปฏิบัติงานที่กำหนด */
function shiftWindow(plan, workDate) {
  var st = parseHM(plan.startTime), en = parseHM(plan.endTime);
  if (!st || !en) return null;

  var sb = new Date(workDate + 'T12:00:00');
  if (st.h < CFG.DAY_START_HOUR) sb.setDate(sb.getDate() + 1);
  var start = atTime(sb, st.h, st.m);

  var eb = new Date(workDate + 'T12:00:00');
  if (en.h < CFG.DAY_START_HOUR) eb.setDate(eb.getDate() + 1);
  var end = atTime(eb, en.h, en.m);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400000);

  return { start: start, end: end };
}

/** กะทั้งหมดของวันนี้ พร้อมเวลาจริงและสถานะ */
function shiftOptions(workDate) {
  return seedShiftPlan().filter(function (p) { return bool(p.active); })
    .map(function (p) {
      var w = shiftWindow(p, workDate);
      if (!w) return null;
      return {
        planId: String(p.planId), name: String(p.name),
        startAt: toIso(w.start), endAt: toIso(w.end),
        startTime: hhmmOf(p.startTime), endTime: hhmmOf(p.endTime),
        graceEarlyMin: num(p.graceEarlyMin, 15),
        lateAfterMin: num(p.lateAfterMin, 15),
        handoverMin: num(p.handoverMin, 15),
        requireHandover: bool(p.requireHandover)
      };
    })
    .filter(function (x) { return x; })
    .sort(function (a, b) { return String(a.startAt) < String(b.startAt) ? -1 : 1; });
}

/** เดากะจากเวลาปัจจุบัน — เลือกกะที่เวลาเริ่มใกล้ที่สุด */
function pickShift(opts, atMs) {
  var best = null, bestGap = 0;
  opts.forEach(function (o) {
    var gap = Math.abs(parseIso(o.startAt).getTime() - atMs);
    if (!best || gap < bestGap) { best = o; bestGap = gap; }
  });
  return best;
}

function openShiftsNow() {
  return readTable('Shifts').filter(function (s) {
    return s.checkInAt && !s.checkOutAt;
  });
}

// ---------------------------------------------------------------------------
// เข้าเวร
// ---------------------------------------------------------------------------
function apiShiftIn(me, req) {
  var workDate = workDateOf(new Date());
  var rows = readTable('Shifts');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].guardUserId) === me.userId && !rows[i].checkOutAt)
      return ok({ shiftId: String(rows[i].shiftId), already: true });
  }

  var chk = shiftPointCheck(num(req.lat), num(req.lng));
  if (chk && !chk.inside && !req.overrideReason)
    return err('อยู่นอกจุดลงเวลา ' + (chk.dist < 0 ? '(อ่านพิกัดไม่ได้)' : chk.dist + ' ม.') +
               ' — รัศมีที่กำหนด ' + chk.radiusM + ' ม.');

  var now  = new Date();
  var opts = shiftOptions(workDate);
  var plan = null;
  if (req.planId) opts.forEach(function (o) { if (o.planId === String(req.planId)) plan = o; });
  if (!plan) plan = pickShift(opts, now.getTime());

  var lateMin = 0, onTime = 'TRUE';
  if (plan) {
    lateMin = Math.max(0, Math.round((now.getTime() - parseIso(plan.startAt).getTime()) / 60000));
    onTime  = (lateMin <= plan.lateAfterMin) ? 'TRUE' : '';
  }

  var id = uid();
  appendRow('Shifts', {
    shiftId: id, workDate: workDate, guardUserId: me.userId, guardName: me.name,
    checkInAt: nowIso(), checkInLat: num(req.lat), checkInLng: num(req.lng),
    checkOutAt: '', checkOutLat: '', checkOutLng: '', status: 'OPEN',
    note: shiftNote('เข้าเวร', chk, req),
    planId: plan ? plan.planId : '', shiftName: plan ? plan.name : '',
    plannedStart: plan ? plan.startAt : '', plannedEnd: plan ? plan.endAt : '',
    lateMin: lateMin, onTime: onTime, earlyOutMin: '',
    handoverId: '', emergency: '', emergencyReason: ''
  });
  audit(me.userId, 'SHIFT_IN', 'SHIFT', id, null, { plan: plan ? plan.name : '', lateMin: lateMin });

  // รับเวรต่อจากคนที่ยังไม่ออก — ให้ฝั่งแอปรู้ว่ามีใครรออยู่
  var waiting = openShiftsNow().filter(function (s) { return String(s.guardUserId) !== me.userId; })
    .map(function (s) { return String(s.guardName || s.guardUserId); });

  if (!onTime)
    notifySupervisor(me.name + ' เข้าเวร' + (plan ? ' (' + plan.name + ')' : '') +
                     ' สาย ' + lateMin + ' นาที', 'MED');

  return ok({ shiftId: id, distanceM: chk ? chk.dist : -1,
              planName: plan ? plan.name : '', lateMin: lateMin, onTime: !!onTime,
              waitingToHandOver: waiting });
}

// ---------------------------------------------------------------------------
// ออกเวร — บังคับให้มีผู้รับเวรก่อน
// ---------------------------------------------------------------------------
var EMERGENCY_REASONS = ['ป่วยกะทันหัน', 'เหตุฉุกเฉินที่บ้าน', 'คนกะถัดไปไม่มา',
                         'ได้รับคำสั่งจากผู้บังคับบัญชา', 'อื่น ๆ'];

function apiShiftOut(me, req) {
  var rows = readTable('Shifts'), mine = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].guardUserId) === me.userId && !rows[i].checkOutAt) { mine = rows[i]; break; }
  }
  if (!mine) return err('ไม่พบเวรที่เปิดอยู่');

  var chk = shiftPointCheck(num(req.lat), num(req.lng));
  if (chk && !chk.inside && !req.overrideReason)
    return err('อยู่นอกจุดลงเวลา ' + (chk.dist < 0 ? '(อ่านพิกัดไม่ได้)' : chk.dist + ' ม.') +
               ' — รัศมีที่กำหนด ' + chk.radiusM + ' ม.');

  // ต้องมีผู้รับเวรหรือไม่
  var needHo = true;
  seedShiftPlan().forEach(function (p) {
    if (String(p.planId) === String(mine.planId)) needHo = bool(p.requireHandover);
  });

  var taker = null;
  rows.forEach(function (s) {
    if (String(s.guardUserId) === me.userId) return;
    if (!s.checkInAt || s.checkOutAt) return;
    if (!taker || String(s.checkInAt) > String(taker.checkInAt)) taker = s;
  });

  var emergency = !!req.emergency;
  if (needHo && !taker && !emergency)
    return err('NO_TAKER|ยังไม่มีผู้รับเวร — รอให้คนกะถัดไปกดเข้าเวรก่อน');

  if (emergency && !taker) {
    var why = String(req.emergencyReason || '').trim();
    if (!why) return err('กรุณาเลือกเหตุผลของการออกเวรฉุกเฉิน');
  }

  var hoId = '', now = nowIso();
  if (taker) {
    hoId = uid();
    appendRow('Handovers', {
      hoId: hoId, workDate: dstr(mine.workDate), ts: now,
      outUserId: me.userId, outName: me.name,
      inUserId: String(taker.guardUserId), inName: String(taker.guardName || ''),
      note: String(req.handoverNote || ''), ackAt: '', status: 'PENDING'
    });
    updateRow('Shifts', taker._row, { handoverId: hoId });
  }

  var endMs  = parseIso(mine.plannedEnd).getTime();
  var early  = (!isNaN(endMs)) ? Math.max(0, Math.round((endMs - Date.now()) / 60000)) : 0;
  var oldNote = String(mine.note || ''), addNote = shiftNote('ออกเวร', chk, req);

  updateRow('Shifts', mine._row, {
    checkOutAt: now, checkOutLat: num(req.lat), checkOutLng: num(req.lng), status: 'CLOSED',
    note: (oldNote && addNote) ? (oldNote + ' | ' + addNote) : (oldNote || addNote),
    earlyOutMin: early, handoverId: hoId,
    emergency: (emergency && !taker) ? 'TRUE' : '',
    emergencyReason: (emergency && !taker) ? String(req.emergencyReason || '') : ''
  });
  audit(me.userId, 'SHIFT_OUT', 'SHIFT', String(mine.shiftId), null,
        { handover: hoId, emergency: emergency && !taker });

  if (emergency && !taker) {
    notify('🚨 ' + me.name + ' ออกเวรฉุกเฉินโดยไม่มีผู้รับเวร\nเหตุผล: ' +
           String(req.emergencyReason || '-') + '\nเวลา ' + fmt(new Date(), 'HH:mm') +
           ' น. — สำนักงานไม่มีเจ้าหน้าที่เฝ้าแล้ว', 'HIGH', 'SHIFT_EMERGENCY',
           String(mine.shiftId), 'ALL');
  } else if (taker) {
    notifySupervisor(me.name + ' ส่งเวรให้ ' + String(taker.guardName || '') +
                     ' เรียบร้อย เวลา ' + fmt(new Date(), 'HH:mm') + ' น.', 'LOW');
  }

  return ok({ shiftId: String(mine.shiftId), distanceM: chk ? chk.dist : -1,
              handoverTo: taker ? String(taker.guardName || '') : '',
              emergency: !!(emergency && !taker), earlyOutMin: early });
}

/** คนรับเวรกดรับทราบเรื่องคงค้าง */
function apiHandoverAck(me, req) {
  var id = String(req.hoId || ''), hit = null;
  readTable('Handovers').forEach(function (h) { if (String(h.hoId) === id) hit = h; });
  if (!hit) return err('ไม่พบรายการส่ง-รับเวร');
  if (String(hit.inUserId) !== me.userId) return err('รายการนี้ไม่ใช่ของคุณ');
  if (hit.ackAt) return ok({ already: true });
  updateRow('Handovers', hit._row, { ackAt: nowIso(), status: 'DONE' });
  return ok({ hoId: id });
}

/** ปุ่มเตือนคนกะถัดไป */
function apiPingNextShift(me) {
  notify('⏰ ' + me.name + ' ยังรอผู้รับเวรอยู่ที่ ' + fmt(new Date(), 'HH:mm') +
         ' น. — ท่านใดรับกะถัดไป กรุณากดลงเวลาเข้าเวรด้วยครับ',
         'MED', 'SHIFT_PING', '', 'ALL');
  return ok({});
}

/** trigger ทุก 15 นาที — เฝ้าช่วงต่อเวรและช่วงที่สำนักงานจะว่าง */
function tickShifts() {
  if (String(cfgGet('NOTIFY_CHANNEL', 'WEBEX')).toUpperCase() === 'OFF') return 0;
  var workDate = workDateOf(new Date());
  var opts = shiftOptions(workDate);
  var open = openShiftsNow();
  var now = Date.now();
  var sent = 0;

  opts.forEach(function (o) {
    var startMs = parseIso(o.startAt).getTime();
    var taken = open.some(function (s) { return String(s.planId) === o.planId; });
    if (taken) return;
    var late = Math.round((now - startMs) / 60000);
    if (late < o.lateAfterMin || late > o.lateAfterMin + 20) return;   // เตือนครั้งเดียวตอนเพิ่งเลย
    notifySupervisor('ยังไม่มีเจ้าหน้าที่เข้า ' + o.name + ' (เริ่ม ' + o.startTime +
                     ' น.) — เลยมาแล้ว ' + late + ' นาที', 'HIGH');
    sent++;
  });
  return sent;
}

// ---------------------------------------------------------------------------
// รอบตรวจเพิ่มนอกรอบ
// ---------------------------------------------------------------------------
/** หารอบอิสระของวันนี้ ถ้ายังไม่มีก็สร้าง */
function freeRoundOf(workDate) {
  var hit = null;
  readTable('Rounds').forEach(function (r) {
    if (dstr(r.workDate) === workDate && String(r.mode || '').toUpperCase() === 'FREE') hit = r;
  });
  if (hit) return hit;

  var base  = new Date(workDate + 'T12:00:00');
  var open  = atTime(base, CFG.DAY_START_HOUR, 0);
  var close = new Date(open.getTime() + 86400000);
  var id = uid();
  appendRow('Rounds', {
    roundId: id, workDate: workDate, dayType: isHoliday(workDate) ? 'HOLIDAY' : 'WORKDAY',
    roundNo: 0, schedAt: toIso(open), openAt: toIso(open), closeAt: toIso(close), flex: 'TRUE',
    guardUserId: '', shiftId: '', status: 'OPEN', startedAt: '', finishedAt: '',
    pointsDone: 0, pointsTotal: 0, mode: 'FREE', cpCodes: '', minStayMin: 0
  });
  SpreadsheetApp.flush();
  var out = null;
  readTable('Rounds').forEach(function (r) { if (String(r.roundId) === id) out = r; });
  return out;
}
