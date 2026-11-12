// Existing clasp login is reused; credentials and backups stay outside the repository.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const scriptId="1JgEmvknlGLd2SxSSo01zg9AskoA2jqLpAmjqu5VnUF39A9NQkfcwHMKD";
const deploymentId="AKfycbzFL1sEoHUWRX-Fc0BBlvg5EClZ9xhrD3URhrHXVxT6db9BuLJvGE28PfMxZoGbipgb";
const base="https://script.googleapis.com/v1/projects/"+scriptId;
const publicUrl="https://script.google.com/macros/s/"+deploymentId+"/exec";
const [command,runArg,description="GAS update"]=process.argv.slice(2);
const run=path.resolve(runArg||path.join(os.tmpdir(),"afc-gas-deploy","runs",new Date().toISOString().replace(/[:.]/g,"-")));
const canonical=content=>JSON.stringify(content.files.map(({name,type,source})=>({name,type,source})).sort((a,b)=>a.name.localeCompare(b.name)));
const check=(condition,message)=>{if(!condition)throw new Error(message);};
const read=name=>fs.readFile(path.join(run,name),"utf8").then(JSON.parse);
const save=(name,data)=>fs.writeFile(path.join(run,name),JSON.stringify(data,null,2));
let accessToken;

async function authenticate(){
  const config=JSON.parse(await fs.readFile(path.join(os.homedir(),".clasprc.json"),"utf8"));
  const token=config.tokens?.["afc-gas-deploy"];
  check(token?.refresh_token&&token?.client_id&&token?.client_secret,"Existing clasp login 'afc-gas-deploy' was not found.");
  const response=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",signal:AbortSignal.timeout(30000),
    body:new URLSearchParams({client_id:token.client_id,client_secret:token.client_secret,refresh_token:token.refresh_token,grant_type:"refresh_token"})
  });
  const data=await response.json();
  check(response.ok&&data.access_token,"Google authentication failed (HTTP "+response.status+"). Reauthorize the existing clasp login if needed.");
  accessToken=data.access_token; // In memory only; never print the OAuth response.
}

async function api(suffix,method="GET",body){
  const response=await fetch(base+suffix,{
    method,signal:AbortSignal.timeout(60000),
    headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  check(response.ok,"Apps Script API "+method+" "+suffix.split("?")[0]+" failed (HTTP "+response.status+").");
  return response.json();
}

async function publicProbe(action){
  const response=await fetch(publicUrl+"?probe="+Date.now(),{
    ...(action?{method:"POST",body:JSON.stringify({action})}:{}),
    signal:AbortSignal.timeout(30000)
  });
  check(response.ok,"Public GAS probe failed (HTTP "+response.status+").");
  let data;try{data=await response.json();}catch{throw new Error("Public GAS probe did not return JSON.");}
  check(action?String(data.error||"").includes("COACH_AUTH_REQUIRED"):data.ok===true,
    action?"Private route did not reject an unauthenticated request: "+action:"Public GAS health check failed.");
}

async function inspect(){
  await fs.mkdir(run,{recursive:true});
  // Refuse to overwrite a previous snapshot.
  const deployment=await api("/deployments/"+deploymentId);
  const head=await api("/content");
  const published=await api("/content?versionNumber="+deployment.deploymentConfig.versionNumber);
  await fs.writeFile(path.join(run,"before-content.json"),JSON.stringify(head,null,2),{flag:"wx"});
  await save("before-deployment.json",deployment);
  await save("published-content.json",published);
  check(canonical(head)===canonical(published),"HEAD differs from the public version. Review the saved snapshots before preparing any update.");
  console.log(JSON.stringify({run,version:deployment.deploymentConfig.versionNumber,files:head.files.map(f=>f.name)}));
}

async function deploy(){
  check(runArg,"deploy requires a reviewed snapshot directory.");
  const before=await read("before-content.json"),previous=await read("before-deployment.json"),prepared=await read("prepared-content.json");
  check(previous.deploymentId===deploymentId&&previous.deploymentConfig.scriptId===scriptId,"Snapshot belongs to a different deployment.");
  check(Array.isArray(prepared.files)&&prepared.files.length>0,"No prepared GAS files.");
  const files=prepared.files.map(({name,type,source})=>({name,type,source}));
  check(new Set(files.map(f=>f.name)).size===files.length,"Duplicate GAS filenames.");
  check(files.every(f=>typeof f.name==="string"&&typeof f.source==="string"&&["SERVER_JS","HTML","JSON"].includes(f.type)),"Invalid GAS file.");
  check(files.find(f=>f.name==="appsscript")?.source===before.files.find(f=>f.name==="appsscript")?.source,"Manifest changes require separate review; this helper preserves the manifest.");
  check(before.files.every(f=>files.some(n=>n.name===f.name&&n.type===f.type)),"Removing or renaming existing GAS files requires separate review.");
  new vm.Script(files.filter(f=>f.type==="SERVER_JS").map(f=>f.source).join("\n"));
  check(canonical(await api("/content"))===canonical(before),"Remote HEAD changed after review. Refusing to overwrite.");
  check(JSON.stringify((await api("/deployments/"+deploymentId)).deploymentConfig)===JSON.stringify(previous.deploymentConfig),"Deployment changed after review.");
  check(canonical(prepared)!==canonical(before),"Prepared content is unchanged.");
  const changes=files.filter(f=>before.files.find(old=>old.name===f.name)?.source!==f.source).map(f=>f.name);
  console.log(JSON.stringify({previousVersion:previous.deploymentConfig.versionNumber,changes}));
  let uploaded=false,version;
  try{
    uploaded=true; // A failed PUT may still have reached Google; check its result during recovery.
    await api("/content","PUT",{files});
    check(canonical(await api("/content"))===canonical(prepared),"Uploaded content differs from reviewed content.");
    version=await api("/versions","POST",{description});
    await save("new-version.json",version);
    const deployment=await api("/deployments/"+deploymentId,"PUT",{deploymentConfig:{...previous.deploymentConfig,versionNumber:version.versionNumber,description}});
    await save("after-deployment.json",deployment);
    const published=await api("/content?versionNumber="+version.versionNumber);
    check(canonical(published)===canonical(prepared),"Published content differs from reviewed content.");
    await save("after-content.json",published);
    await publicProbe();
    const combined=files.filter(f=>f.type==="SERVER_JS").map(f=>f.source).join("\n");
    for(const action of ["getCoachVoiceNotes","getTimeTreeCalendars"]){
      if(combined.includes('case "'+action+'":'))await publicProbe(action);
    }
    console.log(JSON.stringify({version:version.versionNumber,deploymentId,sourceVerified:true,healthVerified:true,run}));
  }catch(error){
    // Restore only our own changes; never overwrite an intervening update.
    try{
      const live=await api("/deployments/"+deploymentId);
      if(version&&live.deploymentConfig.versionNumber===version.versionNumber){
        await api("/deployments/"+deploymentId,"PUT",{deploymentConfig:previous.deploymentConfig});
        console.error("Restored the previous public version.");
      }
      if(uploaded&&canonical(await api("/content"))===canonical(prepared)){
        await api("/content","PUT",{files:before.files.map(({name,type,source})=>({name,type,source}))});
        console.error("Restored previous HEAD content.");
      }
    }catch{console.error("Automatic recovery could not be verified. Inspect the snapshot directory and remote deployment before retrying.");}
    throw error;
  }
}

try{
  check(["inspect","deploy"].includes(command),"Usage: node scripts/gas-release.mjs inspect [snapshot-directory] | deploy <snapshot-directory> <description>");
  await authenticate();
  if(command==="inspect")await inspect();else await deploy();
}catch(error){console.error(error.message);process.exitCode=1;}
