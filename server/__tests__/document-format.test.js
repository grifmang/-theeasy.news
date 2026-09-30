const {screenDocumentFormat}=require('../discovery/document-format');
test.each([
  ['text/plain','A cited statement.'],
  ['text/html','<!doctype html><html><body>Evidence</body></html>'],
  ['text/html','<!-- comment --><html><body>Evidence</body></html>'],
  ['application/pdf','%PDF-1.7\nfixture parser input\n%%EOF']
])('accepts a consistent %s format for later parsing', (mime,text)=>{
  expect(screenDocumentFormat(Buffer.from(text),mime)).toEqual({mime,requiresExtraction:true});
});
test.each([
  ['application/pdf','<html>Access denied</html>'],
  ['text/plain','%PDF-1.7\nbinary'],
  ['text/html','%PDF-1.7\nbinary'],
  ['text/plain','<html>Login page</html>'],
  ['text/plain','PK\x03\x04archive'],
  ['text/html','Not HTML'],
  ['text/plain','binary\x00payload'],
  ['text/plain',''],
  ['application/pdf','%PDF-9.9\ninvalid'],
])('quarantines mismatch declared as %s', (mime,text)=>{
  expect(()=>screenDocumentFormat(Buffer.from(text),mime)).toThrow();
});
test('rejects undecodable UTF-8 instead of inserting replacement characters',()=>{
  expect(()=>screenDocumentFormat(Buffer.from([0xc3,0x28]),'text/plain')).toThrow();
});
