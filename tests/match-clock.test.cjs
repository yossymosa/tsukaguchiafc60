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
const context = vm.createContext({});
vm.runInContext(section("function parseMatchClockInput(", "function GoalPage("), context);
const parse = context.parseMatchClockInput, local = context.matchClockHalfTime;
assert.equal(parse("12", "05"), 725);
assert.equal(parse("0", "00"), 0);
for (const [m,s] of [["", "0"], ["1", ""], ["-1", "0"], ["1", "60"], ["1.5", "0"], ["99999999999999999999", "0"]]) assert.equal(parse(m,s), null);
assert.deepEqual({...local(725,"2nd",["1st","2nd"],600)}, {minute:2,second:5});
assert.deepEqual({...local(1300,"3rd",["1st","2nd","3rd"],600)}, {minute:1,second:40});
assert.deepEqual({...local(1500,"2nd",["1st","2nd"],600)}, {minute:15,second:0});

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

const goalsContext = vm.createContext({getClockSecNow:()=>630,getHalfByClockSec:s=>s<600?"1st":"2nd",
  visibleHalfOptions:["1st","2nd"],perHalfSeconds:600,matchClockHalfTime:local});
vm.runInContext(section("  const getGoalTimeFromClock =", "  const applyClockToGoalDraft =")+"\nthis.getGoalTime = getGoalTimeFromClock;",goalsContext);
assert.deepEqual({...goalsContext.getGoalTime(-20)},{half:"2nd",minute:"0",second:"10"});
goalsContext.getClockSecNow=()=>610;
assert.deepEqual({...goalsContext.getGoalTime(-20)},{half:"1st",minute:"9",second:"50"});
console.log("Match clock: input, start, running adjustment and half-relative event times passed");
