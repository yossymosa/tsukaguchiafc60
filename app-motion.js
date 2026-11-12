(function(global){
  "use strict";

  function mount(root){
    if(!root) return function(){};
    const doc=root.ownerDocument;
    const reduce=global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : {matches:false};
    const seen=new WeakSet();
    const counted=new WeakMap();
    const observed=new Set();
    const counters=new Map();
    const effects=new Map();
    let scanFrame=0,scrollFrame=0,stopped=false;
    const surfaceSelector="[data-reveal],.motion-surface,.match-section,.schedule-detail-panel,.card";
    const progress=doc.createElement("div");
    progress.className="app-scroll-progress";
    progress.setAttribute("aria-hidden","true");
    doc.body.appendChild(progress);

    function stopCounter(el){
      const item=counters.get(el);
      if(!item) return;
      global.cancelAnimationFrame(item.frame);
      item.overlay.remove();
      counters.delete(el);
    }
    function count(el){
      const value=Number(el.getAttribute("data-count"));
      stopCounter(el);
      if(!Number.isFinite(value)||value<0||counted.get(el)===value) return;
      counted.set(el,value);
      if(reduce.matches||value===0) return;
      // Keep Preact's original text and its accessible value intact.
      const overlay=doc.createElement("span");
      overlay.className="count-visual";
      overlay.setAttribute("aria-hidden","true");
      overlay.textContent="0";
      el.appendChild(overlay);
      const item={overlay,frame:0,start:null};
      counters.set(el,item);
      function tick(now){
        if(stopped||reduce.matches||!el.isConnected){stopCounter(el);return;}
        if(item.start===null) item.start=now;
        const t=Math.min(1,(now-item.start)/520);
        overlay.textContent=String(Math.round(value*(1-Math.pow(1-t,3))));
        if(t<1) item.frame=global.requestAnimationFrame(tick);
        else stopCounter(el);
      }
      item.frame=global.requestAnimationFrame(tick);
    }
    function reveal(el){
      if(!reduce.matches) el.classList.add("motion-reveal");
    }
    // Offscreen content remains visible; observation only adds an entrance effect.
    const viewport=typeof global.IntersectionObserver==="function"
      ? new global.IntersectionObserver(entries=>{
          let order=0;
          entries.forEach(entry=>{
            if(!entry.isIntersecting) return;
            const el=entry.target;
            viewport.unobserve(el);observed.delete(el);
            if(el.hasAttribute("data-count")) count(el);
            else{
              el.style.setProperty("--reveal-delay",Math.min(order++,3)*24+"ms");
              reveal(el);
            }
          });
        },{threshold:.06}) : null;

    function observe(el){
      if(!viewport||reduce.matches){if(el.hasAttribute("data-count")) count(el);return;}
      observed.add(el);viewport.observe(el);
    }
    function scan(){
      scanFrame=0;
      if(stopped) return;
      observed.forEach(el=>{if(!el.isConnected){viewport?.unobserve(el);observed.delete(el);}});
      counters.forEach((_item,el)=>{if(!el.isConnected) stopCounter(el);});
      root.querySelectorAll(surfaceSelector).forEach(el=>{
        if(seen.has(el)) return;
        seen.add(el);
        if(el.style.cursor==="pointer"||el.getAttribute("role")==="button") el.classList.add("is-interactive");
        // Animate a group once rather than making its children move twice.
        if(el.parentElement?.closest(surfaceSelector)) return;
        observe(el);
      });
      root.querySelectorAll("[data-count]").forEach(el=>{
        const value=Number(el.getAttribute("data-count"));
        if(counted.get(el)!==value&&!observed.has(el)) observe(el);
      });
      updateProgress();
    }
    function scheduleScan(){if(!stopped&&!scanFrame) scanFrame=global.requestAnimationFrame(scan);}
    const changes=new global.MutationObserver(records=>{
      if(records.some(record=>record.type==="attributes"||
        Array.from(record.addedNodes).some(node=>node.nodeType===1&&!node.classList.contains("count-visual"))||
        Array.from(record.removedNodes).some(node=>node.nodeType===1&&!node.classList.contains("count-visual")))) scheduleScan();
    });
    changes.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["data-count"]});

    function updateProgress(){
      scrollFrame=0;
      const height=Math.max(0,doc.documentElement.scrollHeight-global.innerHeight);
      const value=height>0?Math.max(0,Math.min(1,global.scrollY/height)):0;
      progress.style.setProperty("--scroll-progress",String(value));
    }
    function removeEffect(el){
      global.clearTimeout(effects.get(el));
      el.remove();effects.delete(el);
    }
    function clearEffects(){effects.forEach((_timer,el)=>removeEffect(el));}
    function onScroll(){
      clearEffects();
      if(!scrollFrame&&!stopped) scrollFrame=global.requestAnimationFrame(updateProgress);
    }
    function onClick(event){
      if(reduce.matches||event.defaultPrevented) return;
      const target=event.target.closest?.("button,[role='button']");
      if(!target||!root.contains(target)||target.disabled||target.getAttribute("aria-disabled")==="true") return;
      const rect=target.getBoundingClientRect();
      // Confirm a completed click inside its control; never react to pointer-down or a drag.
      if(rect.width<=0||rect.height<=0||rect.width>220||rect.height>70) return;
      clearEffects();
      const feedback=doc.createElement("span"),style=global.getComputedStyle(target);
      feedback.className="press-feedback";
      feedback.setAttribute("aria-hidden","true");
      Object.assign(feedback.style,{left:rect.left+"px",top:rect.top+"px",width:rect.width+"px",height:rect.height+"px",borderRadius:style.borderRadius,color:style.color});
      doc.body.appendChild(feedback);
      effects.set(feedback,global.setTimeout(()=>removeEffect(feedback),400));
      feedback.addEventListener("animationend",()=>removeEffect(feedback),{once:true});
    }
    function onMotionChange(){
      if(reduce.matches){
        observed.forEach(el=>viewport?.unobserve(el));observed.clear();
        counters.forEach((_item,el)=>stopCounter(el));
        clearEffects();
        root.querySelectorAll(".motion-reveal").forEach(el=>el.classList.remove("motion-reveal"));
      }
      scheduleScan();
    }
    function onAnimationEnd(event){
      if(event.animationName==="cardArrive") event.target.classList.remove("motion-reveal");
    }
    root.addEventListener("click",onClick);
    root.addEventListener("animationend",onAnimationEnd);
    global.addEventListener("scroll",onScroll,{passive:true});
    global.addEventListener("resize",onScroll,{passive:true});
    reduce.addEventListener?.("change",onMotionChange);
    scan();

    return function cleanup(){
      stopped=true;changes.disconnect();viewport?.disconnect();
      global.cancelAnimationFrame(scanFrame);global.cancelAnimationFrame(scrollFrame);
      counters.forEach((_item,el)=>stopCounter(el));
      clearEffects();progress.remove();
      root.removeEventListener("click",onClick);root.removeEventListener("animationend",onAnimationEnd);
      global.removeEventListener("scroll",onScroll);global.removeEventListener("resize",onScroll);
      reduce.removeEventListener?.("change",onMotionChange);
      root.querySelectorAll(".motion-reveal").forEach(el=>el.classList.remove("motion-reveal"));
    };
  }
  global.AFCMotion={mount};
})(window);
