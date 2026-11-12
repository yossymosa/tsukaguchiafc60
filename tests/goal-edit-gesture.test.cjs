const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const buttonSource=source.slice(source.indexOf("function GoalEditButton("),source.indexOf("function GoalPage("));
function fixture(){
  const ref={current:null},edits=[];let button;
  const context={useRef:()=>ref,h:(type,props)=>({type,props})};
  vm.createContext(context);vm.runInContext(buttonSource,context);
  const render=()=>button=context.GoalEditButton({type:"button","aria-label":"ゴールを編集",onEdit:event=>edits.push(event)});
  render();
  const fire=(name,extra={})=>{
    const event={pointerId:1,button:0,isPrimary:true,clientX:160,clientY:300,detail:1,prevented:false,stopped:false,
      preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};
    button.props[name](event);return event;
  };
  return {render,fire,edits};
}
let count=0;
const test=(name,run)=>{run();count++;console.log("OK "+name);};
test("触れた瞬間や指を離した瞬間では開かず、タップのクリックで一度だけ編集する",()=>{
  const f=fixture();assert.equal(f.fire("onPointerDown").prevented,false);assert.equal(f.edits.length,0);
  f.fire("onPointerMove",{clientX:163,clientY:302});f.fire("onPointerUp",{clientX:164,clientY:301});assert.equal(f.edits.length,0);
  f.fire("onClick");assert.equal(f.edits.length,1);
});
test("上下左右へのスライドはスクロールを妨げず、残ったクリックでも編集しない",()=>{
  for(const delta of [{clientY:390},{clientY:200},{clientX:260},{clientX:60}]){
    const f=fixture();f.fire("onPointerDown");
    assert.equal(f.fire("onPointerMove",delta).prevented,false);
    assert.equal(f.fire("onPointerUp",delta).prevented,false);
    const click=f.fire("onClick");assert.equal(click.prevented,true);assert.equal(click.stopped,true);assert.equal(f.edits.length,0);
  }
});
test("指を元の位置に戻しても、移動イベントを取り逃してもスライドを編集にしない",()=>{
  const f=fixture();f.fire("onPointerDown");f.fire("onPointerMove",{clientY:360});f.render();
  f.fire("onPointerMove");f.fire("onPointerUp");f.fire("onClick");assert.equal(f.edits.length,0);
  const g=fixture();g.fire("onPointerDown");g.fire("onPointerUp",{clientY:360});g.fire("onClick");assert.equal(g.edits.length,0);
});
test("操作の中断やボタン外へのドラッグでは開かず、次のタップは正常に開く",()=>{
  for(const name of ["onPointerCancel","onPointerLeave"]){
    const f=fixture();f.fire("onPointerDown");f.fire(name);f.fire("onPointerUp");f.fire("onClick");assert.equal(f.edits.length,0);
    f.fire("onPointerDown");f.fire("onPointerUp");f.fire("onPointerLeave");f.fire("onClick");assert.equal(f.edits.length,1);
  }
});
test("キーボード操作は有効で、右クリックや複数指の操作では開かない",()=>{
  const f=fixture();f.fire("onClick",{detail:0});assert.equal(f.edits.length,1);
  for(const extra of [{button:2},{isPrimary:false}]){
    const g=fixture();g.fire("onPointerDown",extra);g.fire("onPointerUp",extra);g.fire("onClick");assert.equal(g.edits.length,0);
  }
});
console.log(count+" goal edit gesture tests passed");
