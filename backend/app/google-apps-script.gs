/**
 * BETON INDUSTRY → Google Sheets
 *
 * O'rnatish:
 *  1. Google Sheets'da yangi jadval oching (sheets.new).
 *  2. Kengaytmalar (Extensions) → Apps Script.
 *  3. Bu kodni to'liq joylang (eski kodni o'chirib) va saqlang (Ctrl+S).
 *  4. Joylashtirish (Deploy) → Yangi joylashtirish (New deployment) → turi: Veb-ilova (Web app)
 *       - Execute as: Me (o'zim)
 *       - Who has access: Anyone (har kim)
 *     → Deploy → ruxsat bering → "Web app URL" ni nusxalang.
 *  5. URL'ni admin panel → Telegram sozlamalari → Google Sheets bo'limiga kiriting.
 *
 * Xavfsizlik: maxfiy kalitsiz kelgan so'rovlar rad etiladi. Kalitni hech kimga bermang.
 */
const SECRET = '{{SECRET}}';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (!data || data.secret !== SECRET) return reply({ ok: false, error: 'Ruxsat yo‘q' });

    if (data.action === 'ping') {
      return reply({ ok: true, spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
    }
    if (data.action === 'upsert') {
      upsertRow(data.sheet, data.headers, data.row);
      return reply({ ok: true });
    }
    return reply({ ok: false, error: 'Noma’lum amal' });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** Kalit (oxirgi ustun) bo'yicha qatorni yangilaydi yoki yangisini qo'shadi. */
function upsertRow(sheetName, headers, row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#F5B52B');
      sheet.setColumnWidth(5, 420);
    }
    // Formula injection'dan himoya: "=", "+", "-", "@" bilan boshlangan matn formula bo'lib ishlamasin
    const values = row.map(function (v) {
      return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
    });
    const keyCol = headers.length;
    const key = String(row[row.length - 1]);
    const last = sheet.getLastRow();
    let target = -1;
    if (last > 1) {
      const keys = sheet.getRange(2, keyCol, last - 1, 1).getValues();
      for (let i = keys.length - 1; i >= 0; i--) {
        if (String(keys[i][0]).replace(/^'/, '') === key) { target = i + 2; break; }
      }
    }
    if (target > 0) {
      sheet.getRange(target, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
  } finally {
    lock.releaseLock();
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
