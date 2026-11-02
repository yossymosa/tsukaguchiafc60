const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const handlers=source.slice(source.indexOf("  const handleTabSwipeStart="),source.indexOf("  const tabMeta ="));
class Element {
  constructor({interactive=false,scrollable=false,parentElement=null}={}){Object.assign(this,{interactive,parentElement,scrollWidth:scrollable?1000:300,clientWidth:300,overflowX:scrollable?"auto":"visible"});}
  closest(){return this.interactive?this:null;}
}
function fixture(){
  const ref={current:null},window={innerWidth:375,scrollY:0},changes=[],root=new Element();
  const build=new Function("Element","window","getComputedStyle","tabSwipeStartRef","TABS","tab","safeSetTab",handlers+";return {start:handleTabSwipeStart,move:handleTabSwipeMove,end:handleTabSwipeEnd};");
  const events=build(Element,window,el=>el,ref,[{k:"home"},{k:"cal"},{k:"match"}],"cal",(...args)=>changes.push(args));
  const event=(x,y,{target=root,multiple=false,end=false}={})=>({target,currentTarget:root,touches:end?[]:[{clientX:x,clientY:y},...(multiple?[{}]:[])],changedTouches:[{clientX:x,clientY:y}]});
  return {...events,changes,window,root,event};
}
{
  const f=fixture();f.start(f.event(290,200));f.move(f.event(230,203));f.end(f.event(90,205,{end:true}));
  assert.deepEqual(f.changes,[["match","from-right"]]);
}
{
  const f=fixture();f.start(f.event(100,200));f.move(f.event(160,201));f.end(f.event(290,201,{end:true}));
  assert.deepEqual(f.changes,[["home","from-left"]]);
}
for(const reason of ["vertical","scrolled","table","control","multitouch","edge","short"]){
  const f=fixture();let target=f.root;
  if(reason==="table")target=new Element({parentElement:new Element({scrollable:true,parentElement:f.root})});
  if(reason==="control")target=new Element({interactive:true});
  f.start(f.event(reason==="edge"?5:290,200,{target,multiple:reason==="multitouch"}));
  f.move(f.event(reason==="vertical"?288:230,reason==="vertical"?230:202));
  if(reason==="scrolled")f.window.scrollY=60;
  f.end(f.event(reason==="short"?250:90,205,{end:true}));
  assert.deepEqual(f.changes,[],reason+" must not change tabs");
}
console.log("9 swipe gesture checks passed");
