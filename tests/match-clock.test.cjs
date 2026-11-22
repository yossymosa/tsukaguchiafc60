const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `missing ${start}`);
  return source.slice(a, b);
}
const context = vm.createContext({normalizeHalfLabel:value=>value});
vm.runInContext(section("function parseMatchClockInput(", "function GoalPage("), context);
const parse = context.parseMatchClockInput, restore = context.restoreMatchClockDraft;
assert.equal(parse("12", "05"), 725);
assert.equal(parse("0", "00"), 0);
for (const [m,s] of [["", "0"], ["1", ""], ["-1", "0"], ["1", "60"], ["1.5", "0"], ["99999999999999999999", "0"]]) assert.equal(parse(m,s), null);
assert.deepEqual({...restore({matchClockSec:725},["1st","2nd"],600)}, {half:"2nd",seconds:125});
assert.deepEqual({...restore({matchClockSec:900,clockHalf:"2nd"},["1st","2nd"],600)}, {half:"2nd",seconds:900});
assert.deepEqual({...restore(null,["1st","2nd"],600)}, {half:"1st",seconds:0});

function fixture(running, input) {
  const ref = {current:0}, started = {current:0}, resume = {current:{}};
  const state = {running,seconds:null,status:null,modal:"clockInput",alert:""};
  const c = vm.createContext({clockInput:input,clockRunning:running,isAdmin:true,parseMatchClockInput:parse,
    clockBaseSecRef:ref,clockStartMsRef:started,clockResumeRef:resume,Date:{now:()=>123456},
    setMatchClockSec:value=>state.seconds=value,setClockRunning:value=>state.running=value,
    setMatchStatus:value=>state.status=value,setModal:value=>state.modal=value,alert:value=>state.alert=value});
  vm.runInContext(section("  const openClockInput =", "  const currentClockLabel =")+"\nthis.apply = applyClockInput;",c);
  return {apply:c.apply,state,ref,started,resume};
}
let f = fixture(false,{minute:"12",second:"05"}); f.apply(true);
assert.deepEqual(f.state,{running:true,seconds:725,status:"pre",modal:null,alert:""});
assert.equal(f.ref.current,725); assert.equal(f.started.current,123456); assert.equal(f.resume.current,null);
f = fixture(true,{minute:"3",second:"10"}); f.apply(false);
assert.equal(f.state.running,true); assert.equal(f.state.seconds,190); assert.equal(f.started.current,123456);
f = fixture(false,{minute:"5",second:"61"}); f.apply(true);
assert.equal(f.state.running,false); assert.equal(f.state.seconds,null); assert.equal(f.state.modal,"clockInput"); assert(f.state.alert);

const goalsContext = vm.createContext({getClockSecNow:()=>630,clockHalf:"2nd",
  clockToTime:seconds=>({minute:Math.floor(seconds/60),second:seconds%60})});
vm.runInContext(section("  const getGoalTimeFromClock =", "  const applyClockToGoalDraft =")+"\nthis.getGoalTime = getGoalTimeFromClock;",goalsContext);
assert.deepEqual({...goalsContext.getGoalTime(-20)},{half:"2nd",minute:"10",second:"10"});
goalsContext.getClockSecNow=()=>10;
assert.deepEqual({...goalsContext.getGoalTime(-20)},{half:"2nd",minute:"0",second:"00"});
function switchHalf(running, selected) {
  const state={half:selected,seconds:42};
  const c=vm.createContext({clockRunning:running,clockHalf:selected,setClockHalf:v=>state.half=v,setMatchClockSec:v=>state.seconds=v,
    clockBaseSecRef:{current:42},clockStartMsRef:{current:1},clockResumeRef:{current:{}}});
  vm.runInContext(section("  const selectClockHalf =", "  const openClockInput =")+"\nthis.select = selectClockHalf;",c);
  c.select("2nd"); return state;
}
assert.deepEqual(switchHalf(false,"1st"),{half:"2nd",seconds:0});
assert.deepEqual(switchHalf(true,"1st"),{half:"1st",seconds:42});
console.log("Match clock: per-half selection, input, start, restoration and event times passed");
