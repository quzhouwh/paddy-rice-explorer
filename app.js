'use strict';
const $ = id => document.getElementById(id);
const map = L.map('map', {zoomControl: false, preferCanvas: true})
  .setView([9.9, 105.1], 10);
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
L.tileLayer(TILE_URL, {
  maxZoom: 22,
  maxNativeZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const fieldLayer = L.layerGroup().addTo(map);
const outlines = new Map();
const seasons = ['spring','autumn','winter'];
const required = ['field_id','year','season','yield_mean','yield_std','temp_c','precip',
  ...Array.from({length:5}, (_, i) => 'coef_' + (i + 1))];
const number = value => (value === null || value === undefined || value === '' ? NaN : Number(value));
const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '—';
const response = (b,t,p) => b[0]*t + b[1]*t*t + b[2]*p + b[3]*p*p + b[4]*t*p;
const change = (b,t,p,dt,dp) => response(b,t+dt,p+dp) - response(b,t,p);
let fields = new Map(), selected, bounds;
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
  drawFields();
  fit();
  renderChart();
}

function fit(){
  if(!bounds) return;
  const [west, south, east, north] = bounds;
  map.fitBounds([[south, west], [north, east]], {padding: [24, 24], maxZoom: 19});
}

function fieldStyle(highlight){
  return {
    color: highlight ? '#794317' : '#408268',
    weight: highlight ? 2.5 : 1.2,
    fillColor: highlight ? '#f0ab50' : '#69a787',
    fillOpacity: highlight ? 0.72 : 0.53,
  };
}

function drawFields(){
  fieldLayer.clearLayers();
  outlines.clear();
  for(const [id, field] of fields){
    const latLngs = field.polygons.map(polygon =>
      polygon.map(ring => ring.map(([lng, lat]) => [lat, lng]))
    );
    const outline = L.polygon(latLngs, fieldStyle(id === selected)).addTo(fieldLayer);
    outline.on('click', () => setField(id));
    outlines.set(id, outline);
  }
  outlines.get(selected)?.bringToFront();
}

function setField(id){
  if(!fields.has(id)) return;
  outlines.get(selected)?.setStyle(fieldStyle(false));
  selected = id;
  $('field').value = id;
  outlines.get(id)?.setStyle(fieldStyle(true)).bringToFront();
  renderChart();
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
    spring:[.01469,-.0016,.25411,-.0402,-.0087],
    autumn:[-3.905,.05898,-2.467,.03067,.07707],
    winter:[.39453,-.0066,1.1776,-.0205,-.0416]
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
$('plus').onclick = () => map.zoomIn();
$('minus').onclick = () => map.zoomOut();
$('fit').onclick = fit;
new ResizeObserver(() => map.invalidateSize({pan: false})).observe($('map'));
loadConfiguredData();
