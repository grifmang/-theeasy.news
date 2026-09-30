// Build-time only. A separate bundle; never mutate the installed HTML runtime.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const {createParserBundle,verifyParserBundle}=require('../evidence/native/parser-bundle');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const poppler='22.12.0-2+deb12u3',fonts='2.37-6';
function buildPdfBundle({destination,launcherExecutable,rendererExecutable,digestFile}) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.versions.node!=='22.23.1'||process.getuid()!==0)
    throw new Error('PDF build requires root Linux x64 Node22.23.1');
  if(![destination,launcherExecutable,rendererExecutable,digestFile].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.resolve(p)===p&&!p.includes('\0')))
    throw new Error('Canonical absolute PDF build paths required');
  if(!/^\/[a-zA-Z0-9_./-]+$/.test(destination)||destination==='/'||digestFile.startsWith(destination+'/')||
    digestFile===destination||fs.existsSync(destination)||fs.existsSync(digestFile))throw new Error('New separate PDF outputs required');
  for(const [pkg,version] of [['poppler-utils',poppler],['libpoppler126',poppler],['fonts-dejavu-core',fonts],
    ['fontconfig','2.14.1-4'],['tesseract-ocr','5.3.0-2'],['tesseract-ocr-eng','1:4.1.0-2']]) {
    const actual=execFileSync('dpkg-query',['-W','-f=${Version}',pkg],{encoding:'utf8',timeout:5000,maxBuffer:4096}).trim();
    if(actual!==version)throw new Error('PDF package version differs from evaluated build');
  }
  const manifest=createParserBundle({destination,nodeExecutable:process.execPath,launcherExecutable});
  const server=path.resolve(__dirname,'..');
  function add(relative,bytes,executable=false) {
    if(bytes.length>32*1024*1024)throw new Error('PDF input exceeds limit');
    const target=path.join(destination,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    fs.writeFileSync(target,bytes,{flag:'wx',mode:executable?0o555:0o444});
    manifest.files.push({path:relative,size:bytes.length,sha256:hash(bytes),executable});
  }
  function copy(source,relative,executable=false) {
    const fd=fs.openSync(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const before=fs.fstatSync(fd);
      if(!before.isFile()||before.nlink!==1||before.size>32*1024*1024)throw new Error('Invalid PDF build input');
      const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
      if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('PDF build input changed');
      add(relative,bytes,executable);
    } finally {fs.closeSync(fd);}
  }
  for(const tool of ['pdfinfo','pdftotext','pdftoppm','tesseract'])copy('/usr/bin/'+tool,'runtime/'+tool,true);
  copy(rendererExecutable,'runtime/render',true);
  for(const file of ['pdf-page.mjs','pdf-map-worker.mjs','ocr-page.mjs','ocr-map-worker.mjs'])copy(path.join(server,'evidence',file),'runtime/'+file);
  copy('/usr/share/tesseract-ocr/5/tessdata/eng.traineddata','runtime/tessdata/eng.traineddata');
  copy('/usr/share/doc/tesseract-ocr/copyright','runtime/licenses/tesseract-copyright');
  copy('/usr/share/doc/tesseract-ocr-eng/copyright','runtime/licenses/tesseract-eng-copyright');
  copy('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','runtime/fonts/DejaVuSans.ttf');
  copy('/usr/share/doc/fonts-dejavu-core/copyright','runtime/licenses/fonts-dejavu-copyright');
  copy('/usr/share/doc/poppler-utils/copyright','runtime/licenses/poppler-copyright');
  const fontsDirectory=destination+'/runtime/fonts',cacheDirectory=destination+'/runtime/fontconfig-cache';
  // A compromised parser cannot receive global chmod/xattr privileges merely so
  // Fontconfig can initialize a cache in request scratch. Build the cache against
  // the final absolute font path, then seal it with the rest of the runtime.
  const cacheBuild=fs.mkdtempSync('/tmp/easy-pdf-fontcache-');
  try {
    const cache=path.join(cacheBuild,'cache'),configuration=path.join(cacheBuild,'fonts.conf');
    fs.mkdirSync(cache,{mode:0o700});
    fs.utimesSync(path.join(fontsDirectory,'DejaVuSans.ttf'),0,0);fs.utimesSync(fontsDirectory,0,0);
    fs.writeFileSync(configuration,'<?xml version="1.0"?><fontconfig><dir>'+fontsDirectory+'</dir><cachedir>'+cache+
      '</cachedir><alias><family>Helvetica</family><prefer><family>DejaVu Sans</family></prefer></alias></fontconfig>\n');
    execFileSync('/usr/bin/fc-cache',['-r','-f'],{env:{FONTCONFIG_FILE:configuration,LANG:'C.UTF-8'},
      cwd:cacheBuild,timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
    for(const name of fs.readdirSync(cache).sort())copy(path.join(cache,name),'runtime/fontconfig-cache/'+name);
  } finally {fs.rmSync(cacheBuild,{recursive:true,force:true});}
  add('runtime/fonts.conf',Buffer.from('<?xml version="1.0"?><fontconfig><dir>'+fontsDirectory+'</dir><cachedir>'+cacheDirectory+
    '</cachedir><alias><family>Helvetica</family><prefer><family>DejaVu Sans</family></prefer></alias></fontconfig>\n'));
  manifest.kind='pdf-ocr-v1';manifest.runtimeDirectory=destination+'/runtime';
  manifest.pdfPackages={poppler,fontsDejavu:fonts,fontconfig:'2.14.1-4',tesseract:'5.3.0-2',englishData:'1:4.1.0-2'};
  manifest.files.sort((a,b)=>a.path.localeCompare(b.path));
  // This manifest belongs only to the freshly created output; old bundles untouched.
  fs.chmodSync(path.join(destination,'manifest.json'),0o600);
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const manifestSha256=hash(fs.readFileSync(path.join(destination,'manifest.json')));
  verifyParserBundle({directory:destination,expectedManifestSha256:manifestSha256});
  function seal(directory) {
    for(const name of fs.readdirSync(directory)) {
      const target=path.join(directory,name),entry=fs.lstatSync(target);
      if(entry.isDirectory())seal(target);
      else if(entry.isFile()&&entry.nlink===1)fs.chmodSync(target,entry.mode&0o111?0o555:0o444);
      else throw new Error('Unexpected PDF output');
    }
    fs.chmodSync(directory,0o555);
  }
  seal(destination);
  fs.writeFileSync(digestFile,manifestSha256+'\n',{flag:'wx',mode:0o444});
  return {manifestSha256,kind:manifest.kind,files:manifest.files.length};
}
module.exports={buildPdfBundle};
if(require.main===module) {
  try {
    if(process.argv.length!==6)throw new Error('Expected destination launcher renderer digest-file');
    console.log(JSON.stringify(buildPdfBundle({destination:process.argv[2],launcherExecutable:process.argv[3],rendererExecutable:process.argv[4],digestFile:process.argv[5]})));
  } catch {console.error('PDF bundle build rejected; partial output is not a release');process.exitCode=1;}
}
