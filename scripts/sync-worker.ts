import { spawnSync } from "node:child_process";
if(!process.execArgv.some(a=>a.includes("react-server"))&&!process.env.__SYNC_CHILD){const r=spawnSync(process.execPath,[...process.execArgv,"--conditions=react-server",...process.argv.slice(1)],{stdio:"inherit",env:{...process.env,__SYNC_CHILD:"1"}});process.exit(r.status??1);}
async function main(){
 if(process.env.DATABASE_DRIVER!=="postgres")throw new Error("The always-on worker requires PostgreSQL; do not share a PGlite database with the web server.");
 if(process.env.SYNC_WORKER_ENABLED!=="true")throw new Error("Set SYNC_WORKER_ENABLED=true on the worker host after configuring credentials.");
 const {runWorkerPass}=await import("../src/lib/integration/sync-worker");
 let stopping=false;process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
 console.log("Direct Meta worker started. Poll interval: 15 seconds; recovery scan: 15 minutes. Provider limits may delay checks.");
 while(!stopping){const start=Date.now();try{await runWorkerPass();}catch{console.error("Worker pass failed. See stored sync logs.");}if(process.argv.includes("--once"))break;await new Promise(resolve=>setTimeout(resolve,Math.max(1000,15000-(Date.now()-start))));}
 const {getDb}=await import("../src/lib/db");await(await getDb()).close();
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Worker failed");process.exitCode=1;});
