const {randomUUID}=require('crypto');

// Payload MUST come from OAuth2Client.verifyIdToken, never a decoded unverified JWT.
// This function checks claim semantics and identity mapping, not signatures.
function acceptVerifiedGoogleIdentity(db,payload,{audience,now=Date.now()}) {
  if(!payload || typeof audience!=='string' || !audience ||
    !['accounts.google.com','https://accounts.google.com'].includes(payload.iss) ||
    payload.aud!==audience || typeof payload.sub!=='string' || !payload.sub.trim() || payload.sub.length>255 ||
    payload.email_verified!==true || typeof payload.email!=='string' || !payload.email.includes('@') || payload.email.length>254 ||
    !Number.isSafeInteger(now) || now<0 || !Number.isSafeInteger(payload.exp) || payload.exp<=Math.floor(now/1000)) {
    throw new Error('Invalid Google identity claims');
  }
  return db.transaction(()=>{
    const linked=db.prepare('SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=?').get(payload.sub);
    if(linked) return linked;
    // No email-based linking, including old OAuth-only accounts. Recovery is an
    // explicit operator flow; creating a new identity cannot inherit old roles.
    const username=`google:${randomUUID()}`;
    const info=db.prepare("INSERT INTO users(username,password) VALUES(?,'')").run(username);
    db.prepare('INSERT INTO google_identities(subject,user_id) VALUES(?,?)').run(payload.sub,info.lastInsertRowid);
    return db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  }).immediate();
}
module.exports={acceptVerifiedGoogleIdentity};
