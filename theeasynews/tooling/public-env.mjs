export function publicDefines(env) {
  return Object.fromEntries(['REACT_APP_API_URL', 'REACT_APP_GOOGLE_CLIENT_ID']
    .map(key => [`process.env.${key}`, JSON.stringify(env[key] || '')]));
}
