
const esbuild=require('esbuild');const fs=require('fs');const path=require('path');
const prod=process.argv.includes('--production');const watch=process.argv.includes('--watch');
async function main(){const ctx=await esbuild.context({entryPoints:['src/extension.ts'],bundle:true,platform:'node',target:'node18',external:['vscode'],outfile:'out/extension.js',sourcemap:!prod,minify:prod,logLevel:'info'});
// copy sql.js wasm next to bundle
const wasm=path.join('node_modules','sql.js','dist','sql-wasm.wasm');fs.mkdirSync('out',{recursive:true});fs.copyFileSync(wasm,'out/sql-wasm.wasm');console.log('copied sql-wasm.wasm');
if(watch)await ctx.watch();else{await ctx.rebuild();await ctx.dispose();}}
main().catch(e=>{console.error(e);process.exit(1);});
