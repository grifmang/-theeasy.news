const {createHash,timingSafeEqual}=require('crypto');
function cookieName(mode) {return mode==='production'?'__Host-easy_news_session':'easy_news_session';}
function validToken(token) {return typeof token==='string' && /^[a-f0-9]{64}$/.test(token);}
function attributes(mode) {return `Path=/; HttpOnly; SameSite=Lax${mode==='production'?'; Secure':''}`;}
function sessionCookie(token,mode) {
  if(!validToken(token)) throw new Error('Invalid session token');
  return `${cookieName(mode)}=${token}; Max-Age=604800; ${attributes(mode)}`;
}
function clearSessionCookie(mode) {return `${cookieName(mode)}=; Max-Age=0; ${attributes(mode)}`;}
function readSessionToken(header,mode) {
  if(typeof header!=='string' || header.length>16384) return null;
  const entries=header.split(';').map(part=>part.trim()).filter(part=>part.startsWith(`${cookieName(mode)}=`));
  if(entries.length!==1) return null;
  const token=entries[0].slice(cookieName(mode).length+1);
  return validToken(token)?token:null;
}
function csrfToken(token) {
  if(!validToken(token)) throw new Error('Invalid session token');
  return createHash('sha256').update(`easy-news-csrf-v1:${token}`).digest('hex');
}
function validMutation({origin,csrf,token,allowedOrigins}) {
  if(typeof origin!=='string' || !Array.isArray(allowedOrigins) || !allowedOrigins.includes(origin) ||
    !validToken(token) || !validToken(csrf)) return false;
  return timingSafeEqual(Buffer.from(csrf,'hex'),Buffer.from(csrfToken(token),'hex'));
}
module.exports={cookieName,sessionCookie,clearSessionCookie,readSessionToken,csrfToken,validMutation};
