const {cookieName,sessionCookie,clearSessionCookie,readSessionToken,csrfToken,validMutation}=require('../session-transport');
const token='a'.repeat(64);
test('production session cookie is host-only HttpOnly Secure and SameSite',()=>{
  const value=sessionCookie(token,'production');
  expect(value).toContain('__Host-easy_news_session=');
  expect(value).toContain('HttpOnly');expect(value).toContain('Secure');
  expect(value).toContain('SameSite=Lax');expect(value).toContain('Path=/');
  expect(value).not.toContain('Domain=');
  expect(clearSessionCookie('production')).toContain('Max-Age=0');
});
test('cookie parser rejects duplicate names and malformed tokens',()=>{
  const name=cookieName('production');
  expect(readSessionToken(`${name}=${token}`,'production')).toBe(token);
  expect(readSessionToken(`${name}=${token}; ${name}=${token}`,'production')).toBeNull();
  expect(readSessionToken(`${name}=forged`,'production')).toBeNull();
  expect(readSessionToken(undefined,'production')).toBeNull();
});
test('production never accepts the development cookie',()=>{
  expect(readSessionToken(`${cookieName('test')}=${token}`,'production')).toBeNull();
});
test('csrf token is session bound and not the session credential',()=>{
  expect(csrfToken(token)).not.toBe(token);
  expect(csrfToken('b'.repeat(64))).not.toBe(csrfToken(token));
});
test.each([
  {origin:undefined}, {origin:'null'}, {origin:'https://evil.example'},
  {origin:'https://theeasy.news.evil.example'}, {csrf:undefined}, {csrf:'incorrect'}
])('rejects unsafe authenticated mutation %j',change=>{
  expect(validMutation({origin:'https://theeasy.news',csrf:csrfToken(token),token,
    allowedOrigins:['https://theeasy.news'],...change})).toBe(false);
});
test('permits only exact allowed origin with matching csrf token',()=>{
  expect(validMutation({origin:'https://theeasy.news',csrf:csrfToken(token),token,allowedOrigins:['https://theeasy.news']})).toBe(true);
});
