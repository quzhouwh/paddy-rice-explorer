'use strict';
const $ = id => document.getElementById(id);
const canvas = $('map'), ctx = canvas.getContext('2d');
const seasons = ['spring','autumn','winter'];
const required = ['field_id','year','season','yield_mean','yield_std','temp_c','precip',
  ...Array.from({length:5}, (_, i) => 'coef_' + (i + 1))];
const number = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const response = (b,t,p) => b[0]*t + b[1]*t*t + b[2]*p + b[3]*p*p + b[4]*t*p;
const change = (b,t,p,dt,dp) => response(b,t+dt,p+dp) - response(b,t,p);
let fields = new Map(), selected, bounds, view, drag;
const DATA_PATH = './data/Rice_Yield_Demo.geojson';

function loadDataset(data, label, demo = false) {
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('Choose a GeoJSON FeatureCollection.');
  const next = new Map(), box = [Infinity,Infinity,-Infinity,-Infinity];
  for (const f of data.features) {
    if (!f.geometry) continue;
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] :
      f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    if (!polygons.length) continue;
    const p = f.properties || {};
    const missing = required.filter(k => !Object.hasOwn(p,k));
    if (missing.length) throw Error('Missing columns: ' + missing.join(', '));
    const id = String(p.field_id ?? '').trim(), year = number(p.year);
    const season = String(p.season).trim().toLowerCase();
    if (!id || !Number.isInteger(year) || !seasons.includes(season)) throw Error('Check field_id, year and season values.');
    if (!next.has(id)) {
      const extent = [Infinity,Infinity,-Infinity,-Infinity];
      for (const polygon of polygons) for (const ring of polygon) for (const [x,y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>180 || Math.abs(y)>90)
          throw Error('Export your GeoJSON in EPSG:4326.');
        extent[0]=Math.min(extent[0],x); extent[1]=Math.min(extent[1],y);
        extent[2]=Math.max(extent[2],x); extent[3]=Math.max(extent[3],y);
      }
      if (!extent.every(Number.isFinite)) continue;
      for (let i=0;i<4;i++) box[i]=(i<2?Math.min:Math.max)(box[i],extent[i]);
      next.set(id,{extent,polygons,records:new Map()});
    }
    const records = next.get(id).records, key = season + year;
    if (records.has(key)) throw Error('Duplicate field, year and season combination for field ' + id + '.');
    records.set(key,{year,season,y:number(p.yield_mean),sd:number(p.yield_std),t:number(p.temp_c),p:number(p.precip),
      b:required.slice(-5).map(k=>number(p[k]))});
  }
  if (!next.size) throw Error('No polygon fields found.');
  fields=next; bounds=box;
  const ids=[...fields.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const options=document.createDocumentFragment();
  for(const id of ids)options.append(new Option(id,id));
  $('field').replaceChildren(options);
  selected=ids[0];
  $('status').textContent=label + ' · ' + ids.length.toLocaleString() + ' fields';
  $('status').style.fontWeight=demo?'650':'400';
  fit();
  renderChart();
}

function size(){return [canvas.clientWidth,canvas.clientHeight];}
function fit(){
  if(!bounds) return;
  const [w,h]=size(), [a,b,c,d]=bounds;
  const aspect=Math.cos((b+d)*Math.PI/360);
  view={x:(a+c)/2,y:(b+d)/2,aspect,s:Math.min((w*.87)/Math.max((c-a)*aspect,1e-6),(h*.87)/Math.max(d-b,1e-6))};
  draw();
}
function zoom(f,x,y){
  if(!view) return;
  const [w,h]=size();
  x=x??w/2; y=y??h/2;
  view.x+=(x-w/2)/(view.s*view.aspect)*(1-1/f);
  view.y-=(y-h/2)/view.s*(1-1/f);
  view.s*=f;draw();
}
function draw(pick){
  if(!view) return;
  const [w,h]=size(), {s,x,y,aspect}=view;
  const sx=(u)=>w/2+(u-x)*s*aspect, sy=(v)=>h/2+(y-v)*s;
  if(!pick){
    const ratio=window.devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(w*ratio));
    canvas.height=Math.max(1,Math.round(h*ratio));
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#d9e6dd';ctx.beginPath();
    for(let i=0;i<w;i+=40){ctx.moveTo(i,0);ctx.lineTo(i,h);}
    for(let i=0;i<h;i+=40){ctx.moveTo(0,i);ctx.lineTo(w,i);}
    ctx.stroke();
  }
  function paths(id, highlight){
    const item=fields.get(id), [left,bottom,right,top]=item.extent;
    if(sx(right)<0||sx(left)>w||sy(bottom)<0||sy(top)>h) return false;
    if(pick&&(pick[0]<sx(left)-4||pick[0]>sx(right)+4||pick[1]<sy(top)-4||pick[1]>sy(bottom)+4)) return false;
    const path=new Path2D();
    if(sx(right)-sx(left)<4&&sy(bottom)-sy(top)<4){
      path.arc(sx((left+right)/2),sy((bottom+top)/2),highlight?5:3,0,2*Math.PI);
    }else{
      for(const polygon of item.polygons) for(const ring of polygon){
        ring.forEach(([u,v],i)=>i?path.lineTo(sx(u),sy(v)):path.moveTo(sx(u),sy(v)));
        path.closePath();
      }
    }
    if(pick){
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      const hit=ctx.isPointInPath(path,pick[0],pick[1],'evenodd');ctx.restore();return hit;
    }
    ctx.fillStyle=highlight?'#e9aa53':'#7eaf96';ctx.strokeStyle=highlight?'#794317':'#408268';
    ctx.lineWidth=highlight?2:1;ctx.fill(path,'evenodd');ctx.stroke(path);
    return false;
  }
  let hit;
  for(const id of fields.keys()) if(id!==selected&&paths(id,false)) hit=id;
  return selected&&paths(selected,true)?selected:hit;
}

function setField(id){
  if(!id) return;selected=id;$('field').value=id;draw();renderChart();
}
function renderChart(){
  const rows=[...(fields.get(selected)?.records.values()??[])].filter(r=>r.season===$('season').value&&Number.isFinite(r.y)).sort((a,b)=>a.year-b.year);
  $('subtitle').textContent=selected ? 'Field ' + selected : '';
  const dt=number($('dt').value),dp=number($('dp').value);
  let negative=0;
  const series=rows.map(r=>{
    const bad=Number.isFinite(r.p)&&Number.isFinite(dp)&&r.p+dp<0;
    if(bad)negative++;
    const delta=!bad&&[...r.b,r.t,r.p,dt,dp].every(Number.isFinite)?change(r.b,r.t,r.p,dt,dp):NaN;
    const scenario=r.y+delta;
    return {...r,delta,scenario:Number.isFinite(scenario)?scenario:NaN};
  });
  $('scenarioNote').textContent=negative ? 'Scenario omitted for ' + negative + ' year(s) where precipitation would be below zero.' :
    ![dt,dp].every(Number.isFinite)?'Enter both climate changes to show the scenario.':'';
  if(!series.length){
    $('chart').innerHTML='<p class="empty">No yield observations for this field and season.</p>';
    $('results').replaceChildren();return;
  }
  const data=series.flatMap(r=>[r.y,r.y-r.sd,r.y+r.sd,r.scenario]).filter(Number.isFinite);
  const lo=Math.min(...data), hi=Math.max(...data), pad=(hi-lo)*.12||.25;
  const min=lo-pad,max=hi+pad, W=620,H=277,L=78,R=18,T=18,B=40;
  const first=series[0].year,last=series.at(-1).year;
  const x=year=>first===last?(L+W-R)/2:L+(year-first)/(last-first)*(W-L-R);
  const y=value=>T+(max-value)/(max-min)*(H-B-T);
  const xy=(r,v)=>x(r.year).toFixed(2)+','+y(v).toFixed(2);
  function segments(test){
    const groups=[];let group=[];
    for(const r of series){
      if(!test(r)||(group.length&&r.year!==group.at(-1).year+1)){if(group.length)groups.push(group);group=[];}
      if(test(r))group.push(r);
    }
    if(group.length)groups.push(group);return groups;
  }
  const band=segments(r=>Number.isFinite(r.sd)&&r.sd>=0).map(g=>{
    if(g.length===1){const r=g[0];return '<rect x="'+(x(r.year)-5)+'" y="'+y(r.y+r.sd)+'" width="10" height="'+(y(r.y-r.sd)-y(r.y+r.sd))+'" fill="#b9daca"/>';}
    return '<polygon fill="#b9daca" points="'+[...g.map(r=>xy(r,r.y+r.sd)),...g.slice().reverse().map(r=>xy(r,r.y-r.sd))].join(' ')+'"/>';
  }).join('');
  function line(key,color,dash=''){
    return segments(r=>Number.isFinite(r[key])).map(g=>'<polyline fill="none" stroke="'+color+'" stroke-width="2.6" '+dash+' points="'+g.map(r=>xy(r,r[key])).join(' ')+'"/>'+
      g.map(r=>'<circle cx="'+x(r.year)+'" cy="'+y(r[key])+'" r="'+(key==='y'?4.4:3.1)+'" fill="'+color+'"><title>'+r.year+' · '+fmt(r[key])+' ton/ha</title></circle>').join('')).join('');
  }
  const yt=Array.from({length:5},(_,i)=>min+(max-min)*i/4).map(v=>'<path d="M'+L+' '+y(v)+'H'+(W-R)+'" stroke="#e1eae3"/><text x="'+(L-8)+'" y="'+(y(v)+4)+'" text-anchor="end">'+v.toFixed(2)+'</text>').join('');
  const labels=series.filter((_,i)=>i%Math.max(1,Math.ceil(series.length/9))===0).map(r=>'<text x="'+x(r.year)+'" y="'+(H-18)+'" text-anchor="middle">'+r.year+'</text>').join('');
  $('chart').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Yield in ton/ha with standard deviation and climate scenario" fill="#526b61" font-size="12"><text x="15" y="128" transform="rotate(-90 15 128)" text-anchor="middle">Yield (ton/ha)</text>'+yt+labels+band+line('y','#176850')+line('scenario','#a65419','stroke-dasharray="6 4"')+'</svg>';
  $('results').innerHTML='<table><thead><tr><th>Year</th><th>Mean yield (ton/ha)</th><th>SD (ton/ha)</th><th>Scenario yield (ton/ha)</th><th>Yield change (ton/ha)</th></tr></thead><tbody>'+
    series.map(r=>'<tr><td>'+r.year+'</td><td>'+fmt(r.y)+'</td><td>'+fmt(r.sd)+'</td><td>'+fmt(r.scenario)+'</td><td>'+fmt(r.scenario-r.y)+'</td></tr>').join('')+'</tbody></table>';
}

function demoData(){
  const features=[], base={
    spring:[.043983601,-.001139342,.076913503,-.008164176,-.00270173],
    autumn:[-1.05586226,.015827213,-.767565144,.009112041,.024392407],
    winter:[.246346011,-.006010506,.403821944,-.00706342,-.015497853]
  };
  for(let i=0;i<34;i++){
    const row=Math.floor(i/7),col=i%7,u=105.05+col*.004+row*.0018,v=9.91+row*.004+col*.0008;
    const ring=[[u,v],[u+.0032,v+.0004],[u+.0035,v+.003],[u+.0002,v+.0028],[u,v]];
    for(const [j,season] of seasons.entries()) for(let year=2017;year<=2023;year++){
      const p={field_id:String(i+1),year,season,yield_mean:6.4-j*.42+Math.sin((year-2017)*.93+i*.29+j)*.63+(year-2017)*.07,
        yield_std:.18+.055*((i+year)%6),temp_c:26+j*.7+Math.sin(year+i)*.6,precip:3.8+j*1.2+Math.cos(year+i)*.85};
      base[season].forEach((b,k)=>p['coef_'+(k+1)]=b);
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:p});
    }
  }
  return {type:'FeatureCollection',features};
}

async function loadConfiguredData() {
  $('status').textContent = 'Loading field data…';
  try {
    const result = await fetch(DATA_PATH);
    if (!result.ok) throw Error('HTTP ' + result.status);
    loadDataset(await result.json(), 'Kien Giang field data');
  } catch (error) {
    loadDataset(demoData(), 'Synthetic demo · Could not load ' + DATA_PATH + ' (' + error.message + ')', true);
  }
}

$('field').onchange=e=>setField(e.target.value);
for(const id of ['season','dt','dp'])$(id).addEventListener('input',renderChart);
$('reset').onclick=()=>{$('dt').value=0;$('dp').value=0;renderChart();};
$('plus').onclick=()=>zoom(1.5);$('minus').onclick=()=>zoom(1/1.5);$('fit').onclick=fit;
canvas.onwheel=e=>{e.preventDefault();zoom(Math.exp(Math.max(-1,Math.min(1,-e.deltaY*.002))),e.offsetX,e.offsetY);};
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY};};
canvas.onpointermove=e=>{
  if(!drag||!view)return;
  view.x-=(e.clientX-drag.x)/(view.s*view.aspect);view.y+=(e.clientY-drag.y)/view.s;
  drag.x=e.clientX;drag.y=e.clientY;draw();
};
canvas.onpointerup=e=>{if(drag&&Math.hypot(e.clientX-drag.ox,e.clientY-drag.oy)<5){const rect=canvas.getBoundingClientRect();setField(draw([e.clientX-rect.left,e.clientY-rect.top]));}drag=null;};
canvas.onpointercancel=()=>{drag=null;};
loadConfiguredData();
new ResizeObserver(draw.bind(null,undefined)).observe(canvas);
