/* /tcrs/explore — the COM projection viewer.
 *
 * Every TCR:pMHC centre of mass projected onto the 1hhk antigen-binding domain
 * (top-down). Click a circle to load that structure into the Mol* panel below.
 *
 * Sits inside the histo grid: the canvas + Mol* panel are the three-quarter
 * column, the filter panel the one-quarter column, so it stays within the
 * standard body width.
 */
(function () {
const PALETTE = ["#4c78a8","#f58518","#54a24b","#e45756","#72b7b2","#eeca3b","#b279a2","#ff9da6","#9d755d","#bab0ac",
                 "#1f77b4","#d62728","#2ca02c","#9467bd","#8c564b","#e377c2","#17becf","#bcbd22","#7f7f7f","#aec7e8",
                 "#ffbb78","#98df8a","#ff9896","#c5b0d5","#c49c94","#f7b6d2","#dbdb8d","#9edae5"];
const $=s=>document.querySelector(s);
const stage=$("#stage"), wrap=$("#wrap"), bg=$("#bg"), cv=$("#cv"), ctx=cv.getContext("2d"), card=$("#card");
let DATA=null, COORDS={};
let W=0, H=0;
let scale=1;
let cardPdb=null;   // which point the hover card currently shows (keeps it fixed until the point changes)

let curType="peptides";
// appearance is fixed (controls removed): radius 10, 35% fill, outline on, ABD reference shown
const radius=10, opacity=0.35, stroke=true, showRef=true;
let groupby="antigen_type";
let fmode="none";
const fsel={peptide:new Set(), tcr:new Set()};
const atOn={};
let colorKey={};
let selPdb=null;

const typeSel=$("#type");
const atlist=$("#atlist");

// Populate the COM-type select and the antigen-type checkboxes from the data.
function buildControls(){
  Object.keys(DATA.atColors).forEach(k=>atOn[k]=true);
  Object.keys(DATA.figs).forEach(k=>{
    const o=document.createElement("option");
    o.value=k;o.textContent=DATA.typeLabels[k]||k;typeSel.appendChild(o);
  });
  typeSel.value=curType;
  Object.entries(DATA.atColors).forEach(([k,c])=>{
    const l=document.createElement("label");l.className="row";
    l.innerHTML=`<input type="checkbox" checked data-at="${k}"><span class="sw" style="background:${c}"></span>${k}`;
    atlist.appendChild(l);
  });
}

function pts(){ return DATA.figs[curType]||[]; }
function allPts(){ return Object.values(DATA.figs).flat(); }

// Pattern-aware filter test used by BOTH the filter list and the "All shown"
// button, so select-all respects exactly what's typed. Semantics:
//   plain text       -> case-insensitive substring (unchanged legacy behaviour)
//   *                -> wildcard, matches any run of residues (e.g. GIL*TL)
//   [S,V] or [SV]    -> character class, any one listed residue (commas/spaces ok)
// Match is unanchored (substring) so partial motifs still hit; a malformed
// pattern falls back to substring rather than throwing.
function matchFilter(value, query){
  if(!query) return true;
  const v=(value||"").toUpperCase(), q=query.trim().toUpperCase();
  if(!q) return true;
  if(!/[*\[]/.test(q)) return v.includes(q);        // no metachars -> legacy substring
  let re="", i=0;
  while(i<q.length){
    const c=q[i];
    if(c==="*"){ re+=".*"; i++; }
    else if(c==="["){
      const j=q.indexOf("]", i);
      if(j<0){ re+="\\["; i++; }                     // unterminated -> literal '['
      else{ const cls=q.slice(i+1,j).replace(/[^A-Z]/g,""); re+="["+cls+"]"; i=j+1; }
    }
    else if(/[A-Z0-9]/.test(c)){ re+=c; i++; }
    else{ re+="\\"+c; i++; }                          // escape everything else
  }
  try{ return new RegExp(re).test(v); }catch(e){ return v.includes(q); }
}
let UNIV={peptide:[], tcr:[]};

function computeColors(){
  colorKey={};
  if(groupby==="antigen_type"){colorKey=Object.assign({},DATA.atColors);return;}
  if(groupby==="none") return;
  if(groupby==="peptide"){
    // sequence-derived colours, precomputed offline (BLOSUM62 -> MDS -> OKLCh).
    // Read the shipped peptide->hex map; no palette cycling, no browser compute.
    colorKey=Object.assign({}, DATA.epitopeColours||{});
    return;
  }
  const vals=UNIV[groupby]||[];
  vals.forEach((v,i)=>colorKey[v]=PALETTE[i%PALETTE.length]);
}
// Toggle between interactive antigen-type tick-boxes (default) and a read-only
// colour KEY for the tcr / peptide / none colour-by variants. tcr & peptide have
// large value counts, so the key wraps and scrolls (max-height) to stay readable.
function renderColorKey(){
  const atb=$("#atbtns"), ck=$("#colorkey");
  if(groupby==="antigen_type"){
    atlist.style.display="flex"; atb.style.display="flex"; ck.style.display="none"; return;
  }
  atlist.style.display="none"; atb.style.display="none"; ck.style.display="flex";
  ck.innerHTML="";
  if(groupby==="none"){
    ck.innerHTML=`<span class="keyitem"><span class="sw" style="background:#4da3ff"></span>all points (single colour)</span>`;
    return;
  }
  // epitope: the colours are meaningful (sequence-derived), so the key IS the
  // deliverable — show the full sequence-ordered swatch. When an epitope filter is
  // active, narrow the key to that subset (still in sequence order) so it mirrors
  // what's on the canvas. Points sharing a sequence neighbourhood sit adjacent and
  // share a hue; unrelated peptides are far apart on the wheel.
  if(groupby==="peptide"){
    const seq = (DATA.epitopeOrder && DATA.epitopeOrder.length)
      ? DATA.epitopeOrder : UNIV.peptide;   // fallback: alpha order
    const fsub = fsel.peptide;
    const vals = (fsub && fsub.size) ? seq.filter(v=>fsub.has(v)) : seq;
    ck.innerHTML=`<span class="keyitem keyhint">sequence order &rarr;&nbsp;</span>`;
    const frag=document.createDocumentFragment();
    vals.forEach(v=>{
      const s=document.createElement("span"); s.className="keyitem";
      s.innerHTML=`<span class="sw" style="background:${colorKey[v]||'#888'}"></span><span class="mono">${v}</span>`;
      frag.appendChild(s);
    });
    ck.appendChild(frag);
    return;
  }
  // TCR: palette is arbitrary/cycled, so key lists ONLY the values selected in the
  // filter for this same dimension; if none are selected, prompt rather than dumping all.
  const sel=fsel[groupby];
  if(!sel || sel.size===0){
    ck.innerHTML=`<span class="keyitem keyhint">Select TCR names in the filter panel to colour them &rarr;</span>`;
    return;
  }
  const vals=[...sel].sort(), frag=document.createDocumentFragment();
  vals.forEach(v=>{
    const s=document.createElement("span"); s.className="keyitem";
    s.innerHTML=`<span class="sw" style="background:${colorKey[v]}"></span>${v}`;
    frag.appendChild(s);
  });
  ck.appendChild(frag);
}
function colorFor(p){
  if(groupby==="none") return "#4da3ff";
  if(groupby==="antigen_type") return DATA.atColors[p.antigen_type]||"#888";
  return colorKey[p[groupby]]||"#888";
}
function filterActive(){ return fmode!=="none" && fsel[fmode].size>0; }
function visible(p){
  if(filterActive()) return fsel[fmode].has(p[fmode]);
  return atOn[p.antigen_type];
}

function renderFilterList(){
  const list=$("#flist"), sb=$("#fsearch"), btns=$("#fbtns");
  if(fmode==="none"){ list.style.display=sb.style.display=btns.style.display="none"; $("#fhint").textContent=""; updateAtNote(); return; }
  list.style.display="block"; sb.style.display="block"; btns.style.display="flex";
  const q=sb.value||"";
  const vals=UNIV[fmode].filter(v=>matchFilter(v,q));
  list.innerHTML="";
  vals.forEach(v=>{
    const n=allPts().filter(p=>p[fmode]===v).length;
    const l=document.createElement("label");l.className="row";
    l.innerHTML=`<input type="checkbox" ${fsel[fmode].has(v)?"checked":""} data-fv="${encodeURIComponent(v)}"> <span class="mono">${v}</span> <span class="val">${n}</span>`;
    list.appendChild(l);
  });
  $("#fhint").innerHTML = fmode==="peptide"
    ? "Selecting epitopes shows those points across all antigen types.<br>Search accepts patterns: <span class=\"mono\">*</span> wildcard (<span class=\"mono\">GIL*TL</span>), <span class=\"mono\">[S,V]</span> any-of at a position."
    : "Selecting TCR names shows those points across all antigen types.";
  updateAtNote();
}
function updateAtNote(){ /* override note removed */ }

function layout(){
  const w=stage.clientWidth, h=w*H/W;
  // Fit to the width of the three-quarter column and take the full projection
  // height. The standalone app capped this to 58% of the viewport and scrolled
  // the overflow, because it was a fixed-height full-screen app; on a page that
  // just hides half the projection behind a scrollbar, so show all of it and let
  // the page scroll instead.
  wrap.style.width=w+"px"; wrap.style.height=h+"px";
  stage.style.height=h+"px";
  const dpr=window.devicePixelRatio||1;
  cv.width=w*dpr; cv.height=h*dpr; cv.style.width=w+"px"; cv.style.height=h+"px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  scale=w/W; draw();
}
/* ---------------- Facet-shape overlay (added) ----------------
   Describes EXACTLY the set { p in pts() : visible(p) } for the current layer,
   recomputed on every draw(). Pixel<->Angstrom via the calibrated scale below.
   Distances in DATA-pixel space; d_px/PX_PER_A -> A, area_px2/PX_PER_A^2 -> A^2. */
const PX_PER_A=28.98;
let facetOn=true;

// convex hull (Andrew monotone chain) over DATA-pixel coords; returns hull ring.
function facetHull(V){
  const pts=V.map(p=>[p.x,p.y]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const uniq=[]; for(const p of pts){ if(!uniq.length||uniq[uniq.length-1][0]!==p[0]||uniq[uniq.length-1][1]!==p[1]) uniq.push(p); }
  if(uniq.length<3) return uniq;
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[]; for(const p of uniq){ while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],p)<=0) lower.pop(); lower.push(p); }
  const upper=[]; for(let i=uniq.length-1;i>=0;i--){ const p=uniq[i]; while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],p)<=0) upper.pop(); upper.push(p); }
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function polyArea(ring){ let a=0; for(let i=0;i<ring.length;i++){ const p=ring[i],q=ring[(i+1)%ring.length]; a+=p[0]*q[1]-q[0]*p[1]; } return Math.abs(a)/2; }

// full facet descriptor set over the visible points of the current layer.
function facetStats(V){
  const n=V.length;
  if(n<3) return {n:n, ok:false};
  let cx=0,cy=0; for(const p of V){ cx+=p.x; cy+=p.y; } cx/=n; cy/=n;
  let a=0,b=0,d=0,msr=0;
  for(const p of V){ const dx=p.x-cx, dy=p.y-cy; a+=dx*dx; b+=dx*dy; d+=dy*dy; msr+=dx*dx+dy*dy; }
  a/=n; b/=n; d/=n; msr/=n;                       // population covariance
  const tr=a+d, det=a*d-b*b, disc=Math.sqrt(Math.max(0,tr*tr/4-det));
  const l1=tr/2+disc, l2=Math.max(0,tr/2-disc);
  const angle = (b!==0) ? Math.atan2(l1-a, b) : (a>=d?0:Math.PI/2);
  const axMajor=2*Math.sqrt(l1), axMinor=2*Math.sqrt(l2);   // 2-sigma semi-axes (DATA px)
  const rmsA=Math.sqrt(msr)/PX_PER_A;
  const aniso = axMajor>0 ? (1-axMinor/axMajor) : 0;
  const hullA2 = polyArea(facetHull(V))/(PX_PER_A*PX_PER_A);
  return {n:n, ok:true, cx:cx, cy:cy, angle:angle, axMajor:axMajor, axMinor:axMinor, rmsA:rmsA, aniso:aniso, hullA2:hullA2};
}

// dominant group colour among the visible set, else neutral ink.
function facetColour(V){
  const cnt={}; for(const p of V){ const c=colorFor(p); cnt[c]=(cnt[c]||0)+1; }
  let best=null,bn=0,total=V.length; for(const c in cnt){ if(cnt[c]>bn){bn=cnt[c];best=c;} }
  return (best && bn>total*0.6) ? best : "#0a0039";
}

function fmtA(v){ return v.toFixed(2); }
function updateFacetReadout(s){
  const box=$("#facetbox"), msg=$("#fx-msg");
  const rows=["fx-n","fx-rms","fx-aniso","fx-hull"];
  if(!s.ok){
    rows.forEach(id=>$("#"+id).textContent = (id==="fx-n" ? String(s.n) : "—"));
    msg.style.display="block"; msg.textContent="n<3 — need \u22653 points";
    return;
  }
  $("#fx-n").textContent=String(s.n);
  $("#fx-rms").textContent=fmtA(s.rmsA)+" \u00c5";
  $("#fx-aniso").textContent=s.aniso.toFixed(3);
  $("#fx-hull").textContent=fmtA(s.hullA2)+" \u00c5\u00b2";
  msg.style.display="none";
}

// draw 2-sigma + 1-sigma covariance ellipses and a centroid marker (DATA px * scale).
function drawFacetShape(s, col){
  const cx=s.cx*scale, cy=s.cy*scale;
  const A2=s.axMajor*scale, B2=s.axMinor*scale;   // 2-sigma semi-axes (canvas px)
  ctx.save();
  ctx.translate(cx,cy); ctx.rotate(s.angle);
  // 2-sigma ellipse: light fill + stroked outline
  ctx.beginPath(); ctx.ellipse(0,0,A2,B2,0,0,2*Math.PI);
  ctx.globalAlpha=0.10; ctx.fillStyle=col; ctx.fill();
  ctx.globalAlpha=0.85; ctx.lineWidth=2; ctx.strokeStyle=col; ctx.stroke();
  // 1-sigma ellipse (half axes): lighter fill
  ctx.beginPath(); ctx.ellipse(0,0,A2/2,B2/2,0,0,2*Math.PI);
  ctx.globalAlpha=0.10; ctx.fillStyle=col; ctx.fill();
  ctx.globalAlpha=0.55; ctx.lineWidth=1; ctx.strokeStyle=col; ctx.stroke();
  ctx.restore();
  // centroid marker: small ring + cross (axis-aligned, at centroid)
  ctx.save();
  ctx.globalAlpha=0.9; ctx.strokeStyle=col; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(cx,cy,4,0,2*Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-7,cy); ctx.lineTo(cx+7,cy); ctx.moveTo(cx,cy-7); ctx.lineTo(cx,cy+7); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha=1;
}

function draw(){
  const dpr=window.devicePixelRatio||1, w=cv.width/dpr, h=cv.height/dpr;
  ctx.clearRect(0,0,w,h);
  let selPt=null;
  for(const p of pts()){
    if(!visible(p)) continue;
    if(p.pdb===selPdb){ selPt=p; continue; }   // draw selected last, on top
    const x=p.x*scale, y=p.y*scale;
    ctx.beginPath(); ctx.arc(x,y,radius,0,2*Math.PI);
    ctx.globalAlpha=opacity; ctx.fillStyle=colorFor(p); ctx.fill();
    if(stroke){ctx.globalAlpha=Math.min(1,opacity+0.35);
      ctx.lineWidth=1;ctx.strokeStyle="#00000088";ctx.stroke();}
  }
  if(selPt){
    const x=selPt.x*scale, y=selPt.y*scale;
    ctx.beginPath(); ctx.arc(x,y,radius,0,2*Math.PI);
    ctx.globalAlpha=1; ctx.fillStyle=colorFor(selPt); ctx.fill();
    ctx.lineWidth=2.5; ctx.strokeStyle="#000"; ctx.stroke();
  }
  // --- facet-shape overlay: exactly the visible set of the current layer ---
  const V=pts().filter(visible);
  const s=facetStats(V);
  if(facetOn && s.ok){ drawFacetShape(s, facetColour(V)); }
  $("#facetbox").style.display = facetOn ? "block" : "none";
  updateFacetReadout(s);
  ctx.globalAlpha=1;
  if(showRef && DATA.ref && DATA.ref.px){
    const rx=DATA.ref.px[0]*scale, ry=DATA.ref.px[1]*scale;
    ctx.globalAlpha=1; ctx.beginPath(); ctx.arc(rx,ry,5,0,2*Math.PI);
    ctx.fillStyle="#000"; ctx.fill(); ctx.lineWidth=1.5; ctx.strokeStyle="#fff"; ctx.stroke();
  }
  ctx.globalAlpha=1;
}

function hit(mx,my){
  let best=null,bd=1e9;
  for(const p of pts()){ if(!visible(p))continue;
    const dx=p.x*scale-mx, dy=p.y*scale-my, d=dx*dx+dy*dy;
    if(d<bd){bd=d;best=p;} }
  return (best && bd<=Math.pow(radius+4,2))?best:null;
}
cv.addEventListener("mousemove",e=>{
  const r=cv.getBoundingClientRect();
  const p=hit(e.clientX-r.left,e.clientY-r.top);
  if(!p){card.style.display="none";cv.style.cursor="default";cardPdb=null;return;}
  cv.style.cursor="pointer";
  if(p.pdb===cardPdb) return;   // same point — leave the card where it is (fixed, not mouse-following)
  cardPdb=p.pdb;
  card.innerHTML=`<div class="pdb">${p.tcr?"TCR: "+p.tcr:"—"}</div><div class="tcr">${p.pdb}</div>
   <table>
   <tr><td class="k">Allele</td><td class="mono">${p.allele||"—"}</td></tr>
   <tr><td class="k">Epitope</td><td class="mono">${p.peptide||"—"}</td></tr>
   <tr><td class="k">Antigen</td><td>${p.antigen_type||"—"}</td></tr>
   <tr><td class="k">TRAV</td><td class="mono">${p.trav||"—"}</td></tr>
   <tr><td class="k">TRBV</td><td class="mono">${p.trbv||"—"}</td></tr>
   </table>`;
  card.style.display="block";
  let cx=e.clientX+16, cy=e.clientY+16, cw=card.offsetWidth, ch=card.offsetHeight;
  if(cx+cw>innerWidth) cx=e.clientX-cw-16;
  if(cy+ch>innerHeight) cy=e.clientY-ch-16;
  card.style.left=cx+"px"; card.style.top=cy+"px";
});
cv.addEventListener("mouseleave",()=>{card.style.display="none";cardPdb=null;});
cv.addEventListener("click",e=>{
  const r=cv.getBoundingClientRect();
  const p=hit(e.clientX-r.left,e.clientY-r.top);
  // A click on a COM loads it; a click on empty background clears the selection
  // and empties the Mol* panel, so there's a way back to "nothing selected".
  if(p){ selPdb=p.pdb; draw(); loadStructure(p); }
  else { clearStructure(); }
});

typeSel.onchange=e=>{curType=e.target.value;draw();};
$("#facettoggle").onchange=e=>{facetOn=e.target.checked;draw();};
$("#groupby").onchange=e=>{groupby=e.target.value;computeColors();renderColorKey();draw();};
$("#fmode").onchange=e=>{fmode=e.target.value; $("#fsearch").value=""; renderFilterList(); draw();};
$("#fsearch").oninput=renderFilterList;
atlist.addEventListener("change",e=>{const k=e.target.dataset.at;if(k){atOn[k]=e.target.checked;draw();}});
$("#flist").addEventListener("change",e=>{
  const v=e.target.dataset.fv; if(!v)return;
  const val=decodeURIComponent(v);
  if(e.target.checked) fsel[fmode].add(val); else fsel[fmode].delete(val);
  if(groupby===fmode) renderColorKey();   // key mirrors selection when colouring by this dimension
  updateAtNote(); draw();
});
document.querySelectorAll("button[data-all]").forEach(b=>b.onclick=()=>{
  const [,on]=b.dataset.all.split(","); const v=on==="1";
  Object.keys(atOn).forEach(k=>atOn[k]=v); atlist.querySelectorAll("input").forEach(i=>i.checked=v); draw();
});
document.querySelectorAll("button[data-fall]").forEach(b=>b.onclick=()=>{
  if(fmode==="none")return; const v=b.dataset.fall==="1";
  if(v){
    // "All shown": add only the items matching the current search filter (intended
    // "select the ones I've filtered to" behaviour).
    const q=$("#fsearch").value||"";
    UNIV[fmode].filter(x=>matchFilter(x,q)).forEach(x=>fsel[fmode].add(x));
  } else {
    // "None": clear the ENTIRE selection regardless of the current search filter,
    // so selected-but-filtered-out items are cleared too (not just visible ones).
    fsel[fmode].clear();
  }
  if(groupby===fmode) renderColorKey();
  renderFilterList(); draw();
});
window.addEventListener("resize",()=>{layout();molResize();});
try{ new ResizeObserver(()=>molResize()).observe($("#mol")); }catch(e){}

/* ---------------- Mol* panel ----------------
   The lower panel is a HistoTCR viewer (the shared bundled Mol*, chain-id
   colours, peptide in ball-and-stick), reused across the site. The coordinate
   file for a PDB id is resolved server-side and handed over in COORDS — the COM
   points carry no filename, and a third of the structures only exist as altloc
   files, so it cannot be built from a naming convention on the client. */
let mstar=null;
function molResize(){ try{ mstar && mstar.plugin && mstar.plugin.handleResize(); }catch(e){} }

/* Back to "nothing selected": drop the highlighted COM, empty the Mol* panel and
   restore its prompt. */
async function clearStructure(){
  if(selPdb === null) return;
  selPdb = null;
  draw();

  $("#molempty").style.display = "";
  $("#mol").classList.remove("loaded");
  $("#molpill").textContent = "No structure loaded";

  const viewer = mstar || HistoTCR.viewers["molhost"];
  if(viewer){ try{ await viewer.plugin.clear(); }catch(e){ /* already empty */ } }
}

async function loadStructure(p){
  const url = COORDS[p.pdb];
  if(!url){ $("#molpill").innerHTML = `<b>${p.pdb}</b> — no coordinate file`; return; }

  $("#molempty").style.display="none";
  $("#mol").classList.add("loaded");
  $("#molpill").innerHTML = `<b>${p.pdb}</b> · ${p.tcr||"—"} · ${p.peptide||""}`;

  mstar = mstar || HistoTCR.viewers["molhost"];
  if(!mstar){ $("#molpill").textContent="Mol* failed to load."; return; }

  await HistoTCR.replace(mstar, url, {viewerId:"molhost"});
  molResize();
  setTimeout(molResize, 60);
}

/* ---------------- boot ----------------
   DATA (the COM coordinates) and the projection background are static files
   rather than inline blobs, so fetch them before first paint. */
async function boot(){
  const root = document.getElementById("com-viewer");
  COORDS = JSON.parse(root.dataset.coordinates);

  DATA = await (await fetch(root.dataset.comCoords)).json();
  W = DATA.W; H = DATA.H;
  UNIV = {
    peptide:[...new Set(allPts().map(p=>p.peptide).filter(Boolean))].sort(),
    tcr:[...new Set(allPts().map(p=>p.tcr).filter(Boolean))].sort()
  };

  buildControls();
  bg.onload=()=>{computeColors();renderColorKey();renderFilterList();layout();};
  bg.src = root.dataset.background;
  if(bg.complete){computeColors();renderColorKey();renderFilterList();layout();}
}

boot();

})();
