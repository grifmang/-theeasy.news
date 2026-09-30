const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const sessionStore = require('./auth');
const transport = require('./session-transport');
const {acceptVerifiedGoogleIdentity} = require('./google-identity');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const { SCHEMA_VERSION } = require('./storage');

function createApp({db,config = {},services = {}}) {
const googleClientId = config.googleClientId;
const oauthClient = services.oauthClient || (googleClientId ? new OAuth2Client(googleClientId) : null);
function establishSession(req,res,user) {
  const previous=transport.readSessionToken(req.headers.cookie,config.mode);
  if(previous) sessionStore.revokeSession(db,previous);
  const {token}=sessionStore.createSession(db,user.id);
  res.set('Cache-Control','no-store');
  res.set('Set-Cookie',transport.sessionCookie(token,config.mode));
  return {userId:user.id,username:user.username,csrfToken:transport.csrfToken(token)};
}

// --- Auth middleware ---
function authMiddleware(req, res, next) {
  res.set('Cache-Control',req.baseUrl==='/api/v1/editor'?'private, no-store':'no-store');
  const token = transport.readSessionToken(req.headers.cookie,config.mode);
  const session = sessionStore.resolveSession(db,token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.userId = session.userId;
  req.user = session;
  req.sessionToken=token;
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && !transport.validMutation({
    origin:req.headers.origin,csrf:req.headers['x-csrf-token'],token,allowedOrigins
  })) return res.status(403).json({error:'Invalid request origin or CSRF token'});
  next();
}

const app = express();
app.use('/api/v1/editor',(req,res,next)=>{
  res.set('Cache-Control','private, no-store');
  if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin))
    return res.status(403).json({error:'Invalid request origin'});
  next();
});

function requireEditor(req,res,next) {
  if(req.user.role!=='editor') return res.status(403).json({error:'Editor access required'});
  next();
}
function credentialsValid(username,password) {
  return typeof username==='string' && username.trim().length>0 && username.length<=254 &&
    typeof password==='string' && password.length>0 && Buffer.byteLength(password,'utf8')<=72;
}

// --- CORS ---
const allowedOrigins = [
  'https://theeasy.news',
  ...(config.mode==='production'?[]:['http://localhost:3000']),
  ...(config.allowedOrigins || [])
];
app.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method) && !allowedOrigins.includes(req.headers.origin)) {
    return res.status(403).json({error:'Invalid request origin'});
  }
  next();
});
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// --- Rate limiting ---
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try again later' } });
app.use('/api/', limiter);

// Authenticate before buffering large evidence submissions. One million UTF-16
// units can occupy six million JSON bytes when escaped; allow bounded envelope
// overhead without increasing limits on login or other research operations.
const ordinaryJson=bodyParser.json({limit:'100kb',inflate:false});
const documentJson=bodyParser.json({limit:'7mb',inflate:false});
const analysisJson=bodyParser.json({limit:'300kb',inflate:false});
function editorInputError(error,_req,res,_next){
  if(error.type==='entity.too.large')return res.status(413).json({error:'Request body too large'});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON body'});
  if(error.type==='encoding.unsupported')
    return res.status(415).json({error:'Compressed request bodies are not supported'});
  const status=Number.isInteger(error.status)&&error.status>=400&&error.status<500?error.status:500;
  return res.status(status).json({error:status===500?'Editor request failed':'Invalid editor request'});
}
app.use('/api/v1/editor',authMiddleware,requireEditor,(req,res,next)=>{
  const parser=req.method==='POST'&&req.path==='/documents/text'?documentJson:
    req.method==='POST'&&/^\/claims\/[1-9]\d*\/analysis-versions$/.test(req.path)?analysisJson:ordinaryJson;
  parser(req,res,next);
},editorInputError,require('./routes/editor').createEditorRouter(db,{archive:services.archive,sourceRegistry:services.sourceRegistry,htmlExtraction:services.htmlExtraction,
  pdfExtraction:services.pdfExtraction,budgetGuard:services.budgetGuard,budgetLimits:services.budgetLimits||{
  dailyMicros:config.dailyBudgetMicros??0,monthlyMicros:config.monthlyBudgetMicros??0},clock:services.clock||Date.now}));
const publicRoutes=require('./routes/public');
app.use(['/api/v1/topics','/api/v1/claims','/api/v1/analyses','/api/v1/search'],(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method))return next();
  try{
    if(config.publicReadEnabled&&services.publicReadAdmission?.isAvailable())return next();
  }catch{ /* A lost or changed sink cannot authorize a public read. */ }
  res.set('Cache-Control','no-store');
  return res.status(503).json({error:'public_read_unavailable'});
});
app.use('/api/v1',publicRoutes.createPublicRouter(db));
app.get('/api/v1/me/saved',authMiddleware,(req,res)=>{
  res.set('Cache-Control',publicRoutes.PRIVATE_CACHE);
  // Legacy saved_articles references unreviewed article rows. There is no
  // reviewed bookmark migration to the publication manifest yet.
  res.json({items:[]});
});
app.use(ordinaryJson);

app.get('/api/session',authMiddleware,(req,res)=>res.json({...req.user,csrfToken:transport.csrfToken(req.sessionToken)}));
app.post('/api/logout',authMiddleware,(req,res)=>{
  sessionStore.revokeSession(db,req.sessionToken);
  res.set('Set-Cookie',transport.clearSessionCookie(config.mode));
  res.json({message:'Logged out'});
});

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!credentialsValid(username,password)) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const stmt = db.prepare('SELECT * FROM users WHERE username=?');
  const user = stmt.get(username);
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json(establishSession(req,res,user));
});

app.post('/api/register', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!credentialsValid(username,password)) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const info = stmt.run(username, hash);
    res.json(establishSession(req,res,{id:Number(info.lastInsertRowid),username}));
  } catch (err) {
    res.status(400).json({ error: 'User exists' });
  }
});

app.post('/api/google-login', authLimiter, async (req, res) => {
  if (!oauthClient) {
    return res.status(500).json({ error: 'Google login not configured' });
  }
  const { token } = req.body || {};
  if (typeof token!=='string' || !token || token.length>16000) {
    return res.status(400).json({ error: 'Token required' });
  }
  try {
    const ticket = await oauthClient.verifyIdToken({ idToken: token, audience: googleClientId });
    const payload = ticket.getPayload();
    const user = acceptVerifiedGoogleIdentity(db,payload,{audience:googleClientId});
    res.json(establishSession(req,res,user));
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Legacy records have no evidence-bound publication approval. Keep them private;
// the new publication API will expose approved analyses, not these rows.
app.get('/api/articles', (req,res)=>res.json({articles:[],total:0,page:1,totalPages:0}));
app.get('/api/articles/:id', (req,res)=>{
  const exists=db.prepare('SELECT id FROM articles WHERE id=?').get(req.params.id);
  res.status(exists?410:404).json({error:exists?'Legacy article unavailable pending editorial review':'Article not found'});
});
app.get('/api/categories',(req,res)=>res.json({categories:[]}));
app.post('/api/articles',authMiddleware,requireEditor,(req,res)=>
  res.status(410).json({error:'Use the evidence-reviewed publication workflow'}));
app.post('/api/save',authMiddleware,(req,res)=>
  res.status(410).json({error:'Legacy articles are unavailable for bookmarking'}));
app.get('/api/user/:userId/saved',authMiddleware,(req,res)=>{
  if(req.params.userId!==String(req.userId)) return res.status(403).json({error:'Access denied'});
  res.json({articles:[]});
});
app.get('/api/v1/editor/legacy/articles/:id',authMiddleware,requireEditor,(req,res)=>{
  const article=db.prepare('SELECT * FROM articles WHERE id=?').get(req.params.id);
  if(!article) return res.status(404).json({error:'Article not found'});
  res.json({article,status:'legacy_unreviewed'});
});

app.post('/api/authors', authMiddleware, requireEditor, (req, res) => {
  const { name, persona, prompt } = req.body;
  if (!name || !persona || !prompt) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const stmt = db.prepare('INSERT INTO authors (name, persona, prompt) VALUES (?, ?, ?)');
    const info = stmt.run(name, persona, prompt);
    res.json({ authorId: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'Author exists' });
  }
});

app.get('/api/authors', (req, res) => {
  const authors = db.prepare('SELECT id, name, persona FROM authors').all();
  res.json({ authors });
});


app.get('/health/live', (req,res) => res.json({status:'live'}));
app.get('/health/ready', (req,res) => {
  try {
    const version = db.prepare('SELECT MAX(version) version FROM rebuild_migrations').get().version;
    if (version !== SCHEMA_VERSION) throw new Error('Schema mismatch');
    db.prepare('SELECT id FROM articles LIMIT 1').get();
    res.json({status:'ready'});
  } catch {
    res.status(503).json({status:'not_ready'});
  }
});
app.use((error,req,res,next)=>{
  if(error.type==='entity.too.large') return res.status(413).json({error:'Request body too large'});
  if(error.type==='entity.parse.failed') return res.status(400).json({error:'Invalid JSON body'});
  if(error.type==='encoding.unsupported') return res.status(415).json({error:'Compressed request bodies are not supported'});
  next(error);
});
return app;
}
module.exports = {createApp};
