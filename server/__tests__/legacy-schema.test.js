const {openStore,migrate} = require('../storage');
const {migrateLegacy} = require('../legacy-schema');
let db;
beforeEach(()=>{db=openStore(':memory:');});
afterEach(()=>db.close());
test('upgrades minimal legacy articles without fabricating their missing metadata',()=>{
  db.exec("CREATE TABLE articles(id INTEGER PRIMARY KEY,content TEXT); INSERT INTO articles VALUES(1,'Original')");
  migrateLegacy(db); migrateLegacy(db);
  expect(db.prepare('SELECT id,content,title,author,source,category,created_at FROM articles').get())
    .toEqual({id:1,content:'Original',title:null,author:null,source:null,category:null,created_at:null});
});
test('old author records gain nullable metadata and preserve prompts',()=>{
  db.exec("CREATE TABLE authors(id INTEGER PRIMARY KEY,name TEXT,prompt TEXT); INSERT INTO authors VALUES(1,'Original','Retained')");
  migrateLegacy(db);
  expect(db.prepare('SELECT name,prompt,persona FROM authors').get()).toEqual({name:'Original',prompt:'Retained',persona:null});
});
test('research-only database becomes ready without creating articles or identities',()=>{
  migrate(db); migrateLegacy(db);
  expect(db.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM articles').get().n).toBe(0);
});
