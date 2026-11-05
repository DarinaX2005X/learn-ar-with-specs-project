const fs=require('fs'),path=require('path'),vm=require('vm');
const bin=process.env.PATH.split(path.delimiter).find(p=>fs.existsSync(path.resolve(p,'../typescript/lib/typescript.js')));const ts=require(path.resolve(bin,'../typescript/lib/typescript.js'));
module.exports=function(){const cache=new Map(),root=path.resolve(__dirname,'../../Assets');
 function load(file){file=path.resolve(file);if(!path.extname(file))file+='.ts';if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);
 const readFile=file;
 const source=ts.transpileModule(fs.readFileSync(readFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 new Function('module','exports','require',source)(module,module.exports,name=>load(path.resolve(path.dirname(file),name)));return module.exports;}
 return {D:load(path.join(root,'Domain/index.ts')),load,root};};
