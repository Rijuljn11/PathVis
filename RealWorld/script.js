// ====== Map setup ======
const map = L.map('map').setView([28.6448, 77.2167], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// ====== Grid / state ======
const GRID_SIZE = 25;
const CELL_SIZE = 0.004;
let grid = [], startNode = null, endNode = null;
let markers = [], lines = [], running = false, paused = false, animationQueue = [], tempMarkers = [];

// Build grid once
for (let i = 0; i < GRID_SIZE; i++) {
  grid[i] = [];
  for (let j = 0; j < GRID_SIZE; j++) {
    grid[i][j] = {
      lat: 28.64 + i * CELL_SIZE,
      lng: 77.21 + j * CELL_SIZE,
      f: 0, g: 0, h: 0, parent: null,
      wall: Math.random() < 0.08
    };
  }
}

// ====== Utilities ======
function closestNode(latlng) {
  let min = Infinity, node = null;
  for (let r of grid) for (let n of r) {
    const d = Math.hypot(n.lat - latlng.lat, n.lng - latlng.lng);
    if (d < min) { min = d; node = n; }
  }
  return node;
}
function neighbors(node) {
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  const i = grid.findIndex(r => r.includes(node)), j = grid[i].indexOf(node);
  const res = [];
  for (let [dx,dy] of dirs) {
    const ni = i + dx, nj = j + dy;
    if (grid[ni] && grid[ni][nj] && !grid[ni][nj].wall) res.push(grid[ni][nj]);
  }
  return res;
}
function heuristic(a,b){ return Math.hypot(a.lat-b.lat, a.lng-b.lng); }

function clearTempMarkers(){
  tempMarkers.forEach(m=>map.removeLayer(m));
  tempMarkers = [];
}

function resetVisual(keepPoints=true){
  animationQueue.forEach(c=>clearTimeout(c)); animationQueue=[];
  markers.forEach(m=>map.removeLayer(m));
  lines.forEach(l=>map.removeLayer(l));
  tempMarkers.forEach(m=>map.removeLayer(m));
  markers=[]; lines=[]; tempMarkers=[];
  running=false; paused=false;
  for (let r of grid) for (let n of r) { n.parent=null; n.f=0; n.g=0; n.h=0; }

  if (keepPoints) {
    if (startNode) markers.push(L.circleMarker([startNode.lat,startNode.lng],{radius:6,color:'green'}).addTo(map));
    if (endNode)   markers.push(L.circleMarker([endNode.lat,endNode.lng],{radius:6,color:'red'}).addTo(map));
  } else {
    startNode = null; endNode = null;
  }
}

// ====== Metrics & exploration gradient ======
const metrics = { algo:'—', visited:0, startTime:0, endTime:0, execMs:0, pathCost:0, visitIndex:0 };
function resetMetrics(){ metrics.algo='—'; metrics.visited=0; metrics.startTime=0; metrics.endTime=0; metrics.execMs=0; metrics.pathCost=0; metrics.visitIndex=0; updateMetricsUI(); }
function startMetrics(algo){ metrics.algo=algo.toUpperCase(); metrics.visited=0; metrics.visitIndex=0; metrics.startTime=performance.now(); metrics.execMs=0; metrics.pathCost=0; updateMetricsUI(); }
function stopMetrics(){ metrics.endTime=performance.now(); metrics.execMs=Math.round(metrics.endTime-metrics.startTime); updateMetricsUI(); }
function updateMetricsUI(){
  const g=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  g('m-algo', metrics.algo); g('m-visited', metrics.visited); g('m-time', metrics.execMs); g('m-cost', metrics.pathCost.toFixed(4));
}
function explorationColor(){
  const maxHue=210, minHue=0;
  const hue=Math.max(minHue, maxHue - Math.floor(metrics.visitIndex * 2.2));
  return `hsl(${hue},70%,55%)`;
}
function drawExplored(node){
  const c=L.circleMarker([node.lat,node.lng],{radius:2,color:explorationColor()}).addTo(map);
  tempMarkers.push(c);
}

// ====== Map clicks ======
map.on('click',(e)=>{
  if(running) return;
  const node = closestNode(e.latlng);
  if(!startNode){
    startNode=node;
    markers.push(L.circleMarker([node.lat,node.lng],{radius:6,color:'green'}).addTo(map));
  } else if(!endNode){
    endNode=node;
    markers.push(L.circleMarker([node.lat,node.lng],{radius:6,color:'red'}).addTo(map));
  } else {
    alert('Press Reset or Clear All to select new points.');
  }
});

// ====== Buttons ======
document.getElementById('start').addEventListener('click', ()=>{
  const sel = getSingleSelectedAlgo();
  if(startNode && endNode && !running && sel) runAlgorithm(sel, {draw:true, explore:true, measureUI:true});
});
document.getElementById('compare').addEventListener('click', ()=>{
  if(startNode && endNode && !running) compareSelected(['astar','dijkstra','bfs','dfs','greedy']);
});
document.getElementById('stop').addEventListener('click', ()=> paused=true);
document.getElementById('reset').addEventListener('click', ()=>{ resetVisual(true); resetMetrics(); });
document.getElementById('clear').addEventListener('click', ()=>{ resetVisual(false); resetMetrics(); clearResultsTable(); setSummary('Click “Compare All” to compare all algorithms.'); });

// ====== Your exact path colors ======
function algoColor(type){
  if(type==='bfs')      return '#136535ff';                // green
  if(type==='dijkstra') return '#0515c3';                  // blue
  if(type==='dfs')      return '#530372';                  // purple
  if(type==='greedy')   return 'hsla(30, 100%, 50%, 1.00)';// yellow
  return '#d42802';                                        // A* (red)
}

// ====== Path reconstruction ======
async function reconstructPath(node, type, {draw=true}={}){
  const path=[]; let cur=node;
  while(cur){ path.unshift(cur); cur=cur.parent; }

  let cost=0;
  for(let i=0;i<path.length-1;i++){
    cost += heuristic(path[i], path[i+1]);
  }

  if(!draw) return cost;

  const color = algoColor(type);
  for(let i=0;i<path.length-1;i++){
    const p1=path[i], p2=path[i+1];
    const line=L.polyline([[p1.lat,p1.lng],[p1.lat,p1.lng]],{color,weight:4}).addTo(map);
    lines.push(line);
    const steps=15;
    for(let s=1;s<=steps;s++){
      const lat=p1.lat+(p2.lat-p1.lat)*(s/steps);
      const lng=p1.lng+(p2.lng-p1.lng)*(s/steps);
      line.setLatLngs([[p1.lat,p1.lng],[lat,lng]]);
      await new Promise(r=>setTimeout(r,8));
    }
  }
  return cost;
}

// ====== Core algorithm runner ======
async function runAlgorithm(type, {draw=true, explore=true, measureUI=false}={}){
  running=true; paused=false;
  const initNodes=()=>{ for(let r of grid) for(let n of r) n.g=n.h=n.f=Infinity, n.parent=null; startNode.g=0; };
  if(measureUI){ startMetrics(type); }

  const finish = async (endHit) => {
    if(measureUI) stopMetrics();
    if(endHit && draw){
      const cost = await reconstructPath(endHit, type, {draw:true});
      if(measureUI){ metrics.pathCost = cost; updateMetricsUI(); }
    }
    clearTempMarkers(); running=false;
  };

  // BFS
  if(type==='bfs'){
    let queue=[startNode], visited=new Set([startNode]);
    while(queue.length>0){
      if(paused){ await new Promise(r=>setTimeout(r,15)); continue; }
      const current=queue.shift();
      if(current===endNode){ await finish(current); return; }
      if(explore && current!==startNode && current!==endNode){ metrics.visited++; metrics.visitIndex++; drawExplored(current); if(measureUI) updateMetricsUI(); }
      for(let n of neighbors(current)){
        if(!visited.has(n)){ n.parent=current; visited.add(n); queue.push(n); }
      }
      await new Promise(r=>setTimeout(r, explore?6:0));
    }
    alert('No path found!'); running=false; return;
  }

  // DFS
  if(type==='dfs'){
    let stack=[startNode], visited=new Set([startNode]);
    while(stack.length>0){
      if(paused){ await new Promise(r=>setTimeout(r,15)); continue; }
      const current=stack.pop();
      if(current===endNode){ await finish(current); return; }
      if(explore && current!==startNode && current!==endNode){ metrics.visited++; metrics.visitIndex++; drawExplored(current); if(measureUI) updateMetricsUI(); }
      for(let n of neighbors(current)){
        if(!visited.has(n)){ n.parent=current; visited.add(n); stack.push(n); }
      }
      await new Promise(r=>setTimeout(r, explore?6:0));
    }
    alert('No path found!'); running=false; return;
  }

  // Greedy Best-First
  if(type==='greedy'){
    let open=[startNode], inOpen=new Set([startNode]), closed=new Set();
    for(let r of grid) for(let n of r) n.parent=null;
    const getH = (n)=>heuristic(n,endNode);
    while(open.length>0){
      if(paused){ await new Promise(r=>setTimeout(r,15)); continue; }
      let current = open.reduce((a,b)=> (getH(a)<getH(b)?a:b));
      open.splice(open.indexOf(current),1); inOpen.delete(current); closed.add(current);
      if(current===endNode){ await finish(current); return; }
      if(explore && current!==startNode && current!==endNode){ metrics.visited++; metrics.visitIndex++; drawExplored(current); if(measureUI) updateMetricsUI(); }
      for(let n of neighbors(current)){
        if(closed.has(n) || inOpen.has(n)) continue;
        n.parent=current; open.push(n); inOpen.add(n);
      }
      await new Promise(r=>setTimeout(r, explore?6:0));
    }
    alert('No path found!'); running=false; return;
  }

  // A* & Dijkstra
  initNodes();
  const openSet=[startNode], closedSet=[];
  startNode.f = (type==='astar') ? heuristic(startNode,endNode) : 0;

  while(openSet.length>0){
    if(paused){ await new Promise(r=>setTimeout(r,15)); continue; }
    let current = openSet.reduce((a,b)=> a.f<b.f?a:b);
    if(current===endNode){ await finish(current); return; }
    openSet.splice(openSet.indexOf(current),1); closedSet.push(current);
    if(explore && current!==startNode && current!==endNode){ metrics.visited++; metrics.visitIndex++; drawExplored(current); if(measureUI) updateMetricsUI(); }

    for(let n of neighbors(current)){
      if(closedSet.includes(n)) continue;
      const step = heuristic(current,n);
      const tentativeG = current.g + step;
      if(!openSet.includes(n) || tentativeG < n.g){
        n.parent=current;
        n.g=tentativeG;
        n.h=(type==='astar') ? heuristic(n,endNode) : 0;
        n.f=n.g+n.h;
        if(!openSet.includes(n)) openSet.push(n);
      }
    }
    await new Promise(r=>setTimeout(r, explore?6:0));
  }
  alert('No path found!'); running=false;
}

// ====== Comparison Runner ======
async function compareSelected(algos = ['astar','dijkstra','bfs','dfs','greedy']) {
  if(!startNode || !endNode){ alert('Select start and end on the map first.'); return; }
  clearResultsTable();
  setSummary('Running comparison…');

  const results = [];
  for(const algo of algos){
    resetVisual(true);
    const t0 = performance.now();
    const res = await runOnceSilent(algo);
    const t1 = performance.now();
    results.push({
      algo,
      found: res.found,
      visited: res.visited,
      timeMs: Math.round(t1 - t0),
      cost: res.cost
    });
  }

  // Fill results table
  const tbody = document.querySelector('#results tbody');
  for(const r of results){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${labelAlgo(r.algo)}</td>
      <td>${r.found ? 'Yes' : 'No'}</td>
      <td>${r.visited}</td>
      <td>${r.timeMs}</td>
      <td>${Number.isFinite(r.cost) ? r.cost.toFixed(4) : '—'}</td>
    `;
    tbody.appendChild(tr);
  }

  // Highlight winners
  const valid = results.filter(r=>r.found);
  const fastest = results.reduce((a,b)=> (a.timeMs<b.timeMs?a:b));
  const shortest = valid.length ? valid.reduce((a,b)=> (a.cost<b.cost?a:b)) : null;

  highlightWinners(fastest, shortest);

  let summary = `Fastest: ${labelAlgo(fastest.algo)} (${fastest.timeMs} ms). `;
  if(shortest) summary += `Shortest path: ${labelAlgo(shortest.algo)} (cost ${shortest.cost.toFixed(4)}).`;
  else summary += `No algorithm found a path (check walls or positions).`;
  setSummary(summary);
}

// Silent runs (no drawing)
async function runOnceSilent(type){
  let visited=0;
  const initNodes=()=>{ for(let r of grid) for(let n of r) n.g=n.h=n.f=Infinity, n.parent=null; startNode.g=0; };

  if(type==='bfs'){
    let queue=[startNode], seen=new Set([startNode]);
    while(queue.length){
      const cur=queue.shift();
      if(cur===endNode){ const cost = await reconstructPath(cur, type, {draw:false}); return {found:true, visited, cost}; }
      if(cur!==startNode && cur!==endNode) visited++;
      for(let n of neighbors(cur)){ if(!seen.has(n)){ seen.add(n); n.parent=cur; queue.push(n); } }
    }
    return {found:false, visited, cost:Infinity};
  }

  if(type==='dfs'){
    let stack=[startNode], seen=new Set([startNode]);
    while(stack.length){
      const cur=stack.pop();
      if(cur===endNode){ const cost = await reconstructPath(cur, type, {draw:false}); return {found:true, visited, cost}; }
      if(cur!==startNode && cur!==endNode) visited++;
      for(let n of neighbors(cur)){ if(!seen.has(n)){ seen.add(n); n.parent=cur; stack.push(n); } }
    }
    return {found:false, visited, cost:Infinity};
  }

  if(type==='greedy'){
    let open=[startNode], inOpen=new Set([startNode]), closed=new Set();
    for(let r of grid) for(let n of r) n.parent=null;
    const getH=(n)=>heuristic(n,endNode);
    while(open.length){
      let cur=open.reduce((a,b)=> (getH(a)<getH(b)?a:b));
      open.splice(open.indexOf(cur),1); inOpen.delete(cur); closed.add(cur);
      if(cur===endNode){ const cost = await reconstructPath(cur, type, {draw:false}); return {found:true, visited, cost}; }
      if(cur!==startNode && cur!==endNode) visited++;
      for(let n of neighbors(cur)){ if(closed.has(n) || inOpen.has(n)) continue; n.parent=cur; open.push(n); inOpen.add(n); }
    }
    return {found:false, visited, cost:Infinity};
  }

  initNodes();
  const open=[startNode], closed=[];
  startNode.f = (type==='astar') ? heuristic(startNode,endNode) : 0;

  while(open.length){
    let cur=open.reduce((a,b)=> a.f<b.f?a:b);
    if(cur===endNode){ const cost = await reconstructPath(cur, type, {draw:false}); return {found:true, visited, cost}; }
    open.splice(open.indexOf(cur),1); closed.push(cur);
    if(cur!==startNode && cur!==endNode) visited++;
    for(let n of neighbors(cur)){
      if(closed.includes(n)) continue;
      const step=heuristic(cur,n);
      const g2=cur.g+step;
      if(!open.includes(n) || g2<n.g){
        n.parent=cur; n.g=g2; n.h=(type==='astar')?heuristic(n,endNode):0; n.f=n.g+n.h;
        if(!open.includes(n)) open.push(n);
      }
    }
  }
  return {found:false, visited, cost:Infinity};
}

// ====== UI Helpers ======
function getSingleSelectedAlgo(){
  const sel = document.getElementById('algo');
  return sel.value || 'astar';
}
function labelAlgo(v){
  return v==='astar' ? 'A*'
    : v==='dijkstra' ? 'Dijkstra'
    : v==='bfs' ? 'BFS'
    : v==='dfs' ? 'DFS'
    : v==='greedy' ? 'Greedy'
    : v;
}
function clearResultsTable(){
  const tbody=document.querySelector('#results tbody');
  while(tbody.firstChild) tbody.removeChild(tbody.firstChild);
}
function setSummary(text){
  const el=document.getElementById('summary');
  if(el) el.textContent = text;
}
function highlightWinners(fastest, shortest){
  const rows = document.querySelectorAll('#results tbody tr');
  rows.forEach(row=>{
    const algo = row.cells[0].innerText;
    if(algo===labelAlgo(fastest.algo)) row.style.backgroundColor = 'rgba(0,255,0,0.15)';
    if(shortest && algo===labelAlgo(shortest.algo)) row.style.backgroundColor = 'rgba(255,255,0,0.15)';
  });
}

