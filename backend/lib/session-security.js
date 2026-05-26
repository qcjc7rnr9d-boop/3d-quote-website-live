export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('connect.sid', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function revokeAppSessions(db, predicate, { exceptSid = null } = {}) {
  const rows = db.prepare('SELECT sid, sess FROM app_sessions').all();
  const del = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  let revoked = 0;
  for (const row of rows) {
    if (exceptSid && row.sid === exceptSid) continue;
    let sess = null;
    try {
      sess = JSON.parse(row.sess || '{}');
    } catch {
      continue;
    }
    if (predicate(sess, row.sid)) {
      del.run(row.sid);
      revoked += 1;
    }
  }
  return revoked;
}

export function revokeShopSessions(db, shopId, { exceptSid = null } = {}) {
  const id = Number(shopId);
  if (!Number.isFinite(id)) return 0;
  let revoked = revokeAppSessions(db, sess => Number(sess?.shopId) === id, { exceptSid });
  const result = exceptSid
    ? db.prepare('DELETE FROM sessions WHERE shop_id = ? AND token != ?').run(id, exceptSid)
    : db.prepare('DELETE FROM sessions WHERE shop_id = ?').run(id);
  revoked += Number(result.changes || 0);
  return revoked;
}

export function revokeCustomerAccountSessions(db, customerAccountId, { exceptSid = null } = {}) {
  const id = Number(customerAccountId);
  if (!Number.isFinite(id)) return 0;
  return revokeAppSessions(db, sess => Number(sess?.customerId) === id, { exceptSid });
}

export function revokePlatformSessions(db, { exceptSid = null } = {}) {
  return revokeAppSessions(db, sess => !!sess?.platformAdmin, { exceptSid });
}
