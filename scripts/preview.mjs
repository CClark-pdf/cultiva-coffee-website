import {spawn} from 'node:child_process';
import fs from 'node:fs';
import EmbeddedPostgres from 'embedded-postgres';
const args=process.argv.slice(2);const pi=args.indexOf('--port');const port=pi>=0?args[pi+1]:'3000';
const run=(cmd,args)=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',env:process.env});p.on('exit',code=>code===0?resolve():reject(new Error(cmd+' failed: '+code)));});
if(!process.env.DATABASE_URL){
 const pg=new EmbeddedPostgres({databaseDir:'.local/preview-postgres',user:'postgres',password:'preview-local-only',port:55433,persistent:true,postgresFlags:['-k',''],onLog:()=>{},onError:console.error});
 if(!fs.existsSync('.local/preview-postgres/PG_VERSION'))await pg.initialise();await pg.start();
 const client=pg.getPgClient();await client.connect();const exists=await client.query("select 1 from pg_database where datname='cultiva'");if(!exists.rowCount)await pg.createDatabase('cultiva');await client.end();
 process.env.DATABASE_URL='postgresql://postgres:preview-local-only@localhost:55433/cultiva?schema=public';
 const env=fs.readFileSync('.env','utf8');process.env.AUTH_ENCRYPTION_KEY=env.match(/AUTH_ENCRYPTION_KEY="([^"]+)"/)?.[1];
 process.on('SIGTERM',async()=>{await pg.stop();process.exit(0)});
}
await run('node',['node_modules/prisma/build/index.js','migrate','deploy']);
await run('node',['--import','tsx','scripts/seed.ts']);

const app=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',port],{stdio:'inherit',env:process.env});
app.on('exit',c=>process.exit(c||0));
