/* 表示用エフェクトは確定した操作だけに反応し、スクロール・終了時に片付ける。 */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../app-motion.js"),"utf8");
function fixture(reduced=false){
  class Element {
    constructor(doc,tag="div"){
      this.ownerDocument=doc;this.tag=tag;this.children=[];this.attrs={};this.events=new Map();this.style={setProperty(key,value){this[key]=value;}};
      this.className="";this.disabled=false;this.rect={left:15,top:40,width:100,height:44};
      this.classList={contains:name=>this.className.split(" ").includes(name),add:()=>{},remove:()=>{}};
    }
    appendChild(el){this.children.push(el);el.parentElement=this;return el;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(el=>el!==this);this.parentElement=null;}
    contains(el){return this===el||this.children.some(child=>child.contains(el));}
    closest(){return this.tag==="button"||this.attrs.role==="button"?this:this.parentElement?.closest();}
    setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}
    getBoundingClientRect(){return this.rect;}
    querySelectorAll(){return [];}
    addEventListener(name,fn){this.events.set(name,fn);}
    removeEventListener(name,fn){if(this.events.get(name)===fn)this.events.delete(name);}
  }
  const doc={createElement:tag=>new Element(doc,tag),documentElement:{scrollHeight:1200}};
  doc.body=new Element(doc);const root=new Element(doc),target=new Element(doc,"button");root.appendChild(target);
  const events=new Map(),timers=new Map(),frames=new Map();let next=0,motionChange;
  const media={matches:reduced,addEventListener:(_name,fn)=>motionChange=fn,removeEventListener:()=>motionChange=null};
  const window={innerHeight:700,scrollY:0,matchMedia:()=>media,
    getComputedStyle:()=>({borderRadius:"10px",color:"rgb(24,58,89)"}),
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name,fn)=>{if(events.get(name)===fn)events.delete(name);},
    MutationObserver:class {observe(){}disconnect(){}}};
  vm.runInNewContext(source,{window});const cleanup=window.AFCMotion.mount(root);
  const click=extra=>root.events.get("click")({target,detail:1,defaultPrevented:false,...extra});
  const feedback=()=>doc.body.children.filter(el=>el.className==="press-feedback");
  return {root,target,doc,events,timers,frames,media,cleanup,click,feedback,setReduced(value){media.matches=value;motionChange();}};
}
let count=0;const test=(name,run)=>{run();count++;console.log("OK "+name);};
test("確定したクリックだけに反応し、ボタンの範囲内でフィードバックする",()=>{
  const f=fixture();assert.equal(f.root.events.has("pointerdown"),false);assert.equal(f.root.events.has("touchstart"),false);
  assert.equal(f.feedback().length,0);f.click();assert.equal(f.feedback().length,1);
  const feedback=f.feedback()[0];assert.equal(feedback.attrs["aria-hidden"],"true");
  assert.equal(feedback.style.width,"100px");assert.equal(feedback.style.height,"44px");assert.equal(feedback.style.borderRadius,"10px");
  feedback.events.get("animationend")();assert.equal(f.feedback().length,0);assert.equal(f.timers.size,0);f.cleanup();
});
test("スライドなどで取り消されたクリックや無効なボタンには反応しない",()=>{
  const f=fixture();f.click({defaultPrevented:true});assert.equal(f.feedback().length,0);
  f.target.disabled=true;f.click();assert.equal(f.feedback().length,0);
  f.target.disabled=false;f.target.setAttribute("aria-disabled","true");f.click();assert.equal(f.feedback().length,0);f.cleanup();
});
test("連打してもエフェクトを重ねず、スクロール開始ですぐに取り除く",()=>{
  const f=fixture();f.click();f.click();f.click();assert.equal(f.feedback().length,1);assert.equal(f.timers.size,1);
  f.events.get("scroll")();assert.equal(f.feedback().length,0);assert.equal(f.timers.size,0);f.cleanup();
});
test("動きを減らす設定を最初から尊重し、途中変更でも停止する",()=>{
  const f=fixture(true);f.click();assert.equal(f.feedback().length,0);f.cleanup();
  const g=fixture();g.click();assert.equal(g.feedback().length,1);g.setReduced(true);assert.equal(g.feedback().length,0);
  g.click();assert.equal(g.feedback().length,0);g.cleanup();
});
test("アニメーション完了を受け取れなくても自動で片付け、画面終了時に処理を残さない",()=>{
  const f=fixture();f.click();const timer=[...f.timers.values()][0];timer();assert.equal(f.feedback().length,0);assert.equal(f.timers.size,0);
  f.click();f.events.get("scroll")();f.click();f.cleanup();
  assert.equal(f.feedback().length,0);assert.equal(f.doc.body.children.length,0);assert.equal(f.events.size,0);
  assert.equal(f.root.events.size,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
console.log(count+" motion feedback tests passed");
