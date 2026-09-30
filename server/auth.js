const {randomBytes,createHash}=require('crypto');
const ABSOLUTE_MS=7*24*60*60*1000;
const IDLE_MS=24*60*60*1000;
function clock(now) {
  if(!Number.isSafeInteger(now) || now<0 || now>Number.MAX_SAFE_INTEGER-ABSOLUTE_MS) throw new Error('Invalid session clock');
}
function digest(token) { return createHash('sha256').update(token).digest('hex'); }
function validToken(token) { return typeof token==='string' && /^[a-f0-9]{64}$/.test(token); }
function createSession(db,userId,now=Date.now()) {
  clock(now);
  if(!Number.isSafeInteger(userId) || userId<=0 || !db.prepare('SELECT id FROM users WHERE id=?').get(userId)) throw new Error('Unknown user');
  const token=randomBytes(32).toString('hex');
  const expiresAt=now+ABSOLUTE_MS;
  db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,created_at,last_seen,expires_at,idle_expires_at)
    VALUES(?,?,?,?,?,?)`).run(digest(token),userId,now,now,expiresAt,now+IDLE_MS);
  return {token,expiresAt};
}
function resolveSession(db,token,now=Date.now()) {
  clock(now);
  if(!validToken(token)) return null;
  return db.transaction(()=>{
    const row=db.prepare(`SELECT s.*,u.username,COALESCE(r.role,'reader') role
      FROM auth_sessions s JOIN users u ON u.id=s.user_id
      LEFT JOIN user_roles r ON r.user_id=u.id WHERE s.token_hash=?`).get(digest(token));
    if(!row || row.revoked || now<row.last_seen || now>=row.expires_at || now>=row.idle_expires_at) return null;
    db.prepare('UPDATE auth_sessions SET last_seen=?,idle_expires_at=? WHERE token_hash=?')
      .run(now,Math.min(row.expires_at,now+IDLE_MS),row.token_hash);
    return {userId:row.user_id,username:row.username,role:row.role,expiresAt:row.expires_at};
  }).immediate();
}
function revokeSession(db,token) {
  if(!validToken(token)) return false;
  return db.prepare('UPDATE auth_sessions SET revoked=1 WHERE token_hash=? AND revoked=0').run(digest(token)).changes===1;
}
module.exports={createSession,resolveSession,revokeSession};
