// ======= Config =======
const COLORS = {
  astar:   '#d42802',          // red
  dijkstra:'#0515c3',          // blue
  bfs:     '#136535ff',        // green
  dfs:     '#530372',          // purple
  greedy:  'hsla(30, 100%, 50%, 1.00)' // yellow
};
const DEFAULT_GRID = { rows: 25, cols: 45 };
const WALL_PROB = 0.22; // random walls
const ANIM_DELAY = 12;  // fixed animation delay 

// ======= State =======
let rows = DEFAULT_GRID.rows, cols = DEFAULT_GRID.cols;
let grid = [];           // 2D nodes
let start = null, end = null;
let running = false, paused = false;
let paintMode = 'wall';  // 'start' | 'end' | 'wall' | 'erase'
let isMouseDown = false;
let eraseModifier = false; // alt key/right click

// Metrics
const metrics = { algo:'Select an Algorithm', visited:0, startTime:0, endTime:0, ms:0, cost:0, tick:0 };

// ======= DOM =======
const gridEl = document.getElementById('grid');
const algoSel = document.getElementById('algo');
const runBtn = document.getElementById('run');
const pauseBtn = document.getElementById('pause');
const resetBtn = document.getElementById('reset');
const clearBtn = document.getElementById('clear');
const randomBtn = document.getElementById('random');
const modeStartBtn = document.getElementById('modeStart');
const modeEndBtn = document.getElementById('modeEnd');
const modeWallBtn = document.getElementById('modeWall');
const modeEraseBtn = document.getElementById('modeErase');
const gridSizeSel = document.getElementById('gridSize');

const mAlgo = document.getElementById('m-algo');
const mVisited = document.getElementById('m-visited');
const mTime = document.getElementById('m-time');
const mCost = document.getElementById('m-cost');

// ======= Helpers =======
const idx = (r,c)=> r*cols + c;
const inBounds = (r,c)=> r>=0 && c>=0 && r<rows && c<cols;
const neighbors4 = (n) => {
  const res = [];
  const dd = [[1,0],[-1,0],[0,1],[0,-1]];
  for(const [dr,dc] of dd){
    const nr = n.r + dr, nc = n.c + dc;
    if(inBounds(nr,nc) && !grid[nr][nc].wall) res.push(grid[nr][nc]);
  }
  return res;
};
const dist = (a,b)=> Math.hypot(a.r-b.r, a.c-b.c);

function updateMetricsUI(){
  mAlgo.textContent = metrics.algo;
  mVisited.textContent = metrics.visited;
  mTime.textContent = metrics.ms;
  mCost.textContent = metrics.cost.toFixed(3);
}
function startMetrics(){
  metrics.visited = 0; metrics.tick = 0; metrics.cost = 0;
  metrics.startTime = performance.now(); metrics.ms = 0;
  updateMetricsUI();
}
function stopMetrics(){
  metrics.endTime = performance.now();
  metrics.ms = Math.round(metrics.endTime - metrics.startTime);
  updateMetricsUI();
}
function explorationColor(){
  // Blue->Green as exploration increases
  const maxHue = 220, minHue = 130;
  const hue = Math.max(minHue, maxHue - Math.floor(metrics.tick * 0.2));
  return `hsl(${hue}, 70%, 55%)`;
}

// ======= Grid Build / Render =======
function makeNode(r,c){
  return { r, c, wall:false, start:false, end:false, parent:null, g:Infinity, h:0, f:Infinity };
}
function buildGrid(){
  grid = Array.from({length:rows}, (_,r)=> Array.from({length:cols}, (_,c)=> makeNode(r,c)));
  // default start/end
  start = grid[Math.floor(rows/2)][Math.floor(cols/4)];
  end   = grid[Math.floor(rows/2)][Math.floor(3*cols/4)];
  start.start = true; end.end = true;
}
function applyRandomWalls(){
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const n = grid[r][c];
      if(n.start || n.end) { n.wall=false; continue; }
      n.wall = Math.random() < WALL_PROB;
    }
  }
}
function clearWalls(){
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const n = grid[r][c];
    if(!n.start && !n.end) n.wall=false;
  }
}
function resetParents(){
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const n = grid[r][c];
    n.parent=null; n.g=Infinity; n.f=Infinity; n.h=0;
  }
}
function renderGrid(){
  gridEl.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'board';
  board.style.gridTemplateColumns = `repeat(${cols}, 22px)`;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const n = grid[r][c];
      const cell = document.createElement('div');
      cell.className = 'cell' + (n.wall?' wall':'') + (n.start?' start':'') + (n.end?' end':'');
      cell.dataset.r = r; cell.dataset.c = c;
      board.appendChild(cell);
    }
  }
  gridEl.appendChild(board);
}

// ======= Paint interactions =======
function setPaintMode(mode){
  paintMode = mode;
  [modeStartBtn,modeEndBtn,modeWallBtn,modeEraseBtn].forEach(b=>b.classList.remove('btn-primary'));
  if(mode==='start') modeStartBtn.classList.add('btn-primary');
  if(mode==='end')   modeEndBtn.classList.add('btn-primary');
  if(mode==='wall')  modeWallBtn.classList.add('btn-primary');
  if(mode==='erase') modeEraseBtn.classList.add('btn-primary');
}

gridEl.addEventListener('mousedown', (e)=>{
  if(running) return;
  isMouseDown = true;
  eraseModifier = e.button===2 || e.altKey;
  handlePaint(e);
});
gridEl.addEventListener('contextmenu', e=> e.preventDefault());
gridEl.addEventListener('mousemove', (e)=>{ if(isMouseDown) handlePaint(e); });
window.addEventListener('mouseup', ()=> isMouseDown=false);
window.addEventListener('keydown', (e)=>{ if(e.key==='Alt') eraseModifier=true; });
window.addEventListener('keyup', (e)=>{ if(e.key==='Alt') eraseModifier=false; });

function handlePaint(e){
  const el = e.target;
  if(!el.classList.contains('cell')) return;
  const r = +el.dataset.r, c = +el.dataset.c;
  const n = grid[r][c];

  const mode = eraseModifier ? 'erase' : paintMode;

  if(mode==='start'){
    start.start=false;
    start = n; start.start=true; start.wall=false;
  } else if(mode==='end'){
    end.end=false;
    end = n; end.end=true; end.wall=false;
  } else if(mode==='wall'){
    if(n.start || n.end) return;
    n.wall = true;
  } else if(mode==='erase'){
    if(n.start || n.end) return;
    n.wall = false;
  }
  renderGrid();
}

// ======= Visualization helpers =======
function clearVisitAndPath(){
  document.querySelectorAll('.cell').forEach(cell=>{
    cell.classList.remove('visited','path');
    cell.style.background = ''; 
    cell.style.color = '';      
  });
}
function drawVisited(n){
  const cell = cellAt(n.r,n.c);
  if(!cell || cell.classList.contains('start') || cell.classList.contains('end')) return;
  cell.classList.add('visited');
  cell.style.background = explorationColor();
}
function cellAt(r,c){
  return document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
}
async function drawPath(endNode, algo){
  const color = COLORS[algo] || COLORS.astar;
  const path = [];
  let cur = endNode;
  while(cur){ path.unshift(cur); cur = cur.parent; }
  let cost = 0;
  for(let i=0;i<path.length-1;i++) cost += dist(path[i], path[i+1]);

  for(let i=0;i<path.length;i++){
    const p = path[i];
    const cell = cellAt(p.r,p.c);
    if(!cell) continue;
    cell.classList.add('path');
    cell.style.color = color;
    await sleep(ANIM_DELAY);
  }
  return cost;
}
const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// ======= Algorithms =======
async function run(){
  if(running) return;
  running = true; paused = false;
  clearVisitAndPath(); resetParents();
  metrics.algo = algoSel.value.toUpperCase(); startMetrics(); updateMetricsUI();

  let found = false, cost = Infinity;

  if(algoSel.value==='bfs')       ({found, cost} = await BFS());
  else if(algoSel.value==='dfs')  ({found, cost} = await DFS());
  else if(algoSel.value==='greedy')({found, cost} = await GREEDY());
  else                             ({found, cost} = await ASTAR_DIJKSTRA(algoSel.value)); // astar|dijkstra

  stopMetrics();
  if(found){ metrics.cost = cost; updateMetricsUI(); }
  else alert('No path found.');
  running = false;
}

async function BFS(){
  const q = [start]; const seen = new Set([start]);
  while(q.length){
    await waitIfPaused();
    const cur = q.shift();
    if(cur!==start && cur!==end){ metrics.visited++; metrics.tick++; drawVisited(cur); updateMetricsUI(); await sleep(ANIM_DELAY); }
    if(cur===end){ const cost = await drawPath(cur,'bfs'); return {found:true, cost}; }
    for(const nb of neighbors4(cur)){
      if(!seen.has(nb)){ seen.add(nb); nb.parent = cur; q.push(nb); }
    }
  }
  return {found:false, cost:Infinity};
}
async function DFS(){
  const stack = [start]; const seen = new Set([start]);
  while(stack.length){
    await waitIfPaused();
    const cur = stack.pop();
    if(cur!==start && cur!==end){ metrics.visited++; metrics.tick++; drawVisited(cur); updateMetricsUI(); await sleep(ANIM_DELAY); }
    if(cur===end){ const cost = await drawPath(cur,'dfs'); return {found:true, cost}; }
    for(const nb of neighbors4(cur)){
      if(!seen.has(nb)){ seen.add(nb); nb.parent = cur; stack.push(nb); }
    }
  }
  return {found:false, cost:Infinity};
}
async function GREEDY(){
  const open = [start]; const inOpen = new Set([start]); const closed = new Set();
  while(open.length){
    await waitIfPaused();
    // pick by h only
    let cur = open.reduce((a,b)=> (heuristic(a)<heuristic(b)?a:b));
    open.splice(open.indexOf(cur),1); inOpen.delete(cur); closed.add(cur);
    if(cur!==start && cur!==end){ metrics.visited++; metrics.tick++; drawVisited(cur); updateMetricsUI(); await sleep(ANIM_DELAY); }
    if(cur===end){ const cost = await drawPath(cur,'greedy'); return {found:true, cost}; }
    for(const nb of neighbors4(cur)){
      if(closed.has(nb) || inOpen.has(nb)) continue;
      nb.parent = cur; open.push(nb); inOpen.add(nb);
    }
  }
  return {found:false, cost:Infinity};

  function heuristic(n){ return dist(n,end); }
}
async function ASTAR_DIJKSTRA(type){
  // type: 'astar' or 'dijkstra'
  start.g = 0;
  start.h = type==='astar' ? dist(start,end) : 0;
  start.f = start.g + start.h;

  const open = [start]; const closed = new Set();

  while(open.length){
    await waitIfPaused();
    // pick min f
    const cur = open.reduce((a,b)=> a.f<b.f?a:b);
    open.splice(open.indexOf(cur),1); closed.add(cur);

    if(cur!==start && cur!==end){ metrics.visited++; metrics.tick++; drawVisited(cur); updateMetricsUI(); await sleep(ANIM_DELAY); }
    if(cur===end){ const cost = await drawPath(cur, type==='astar'?'astar':'dijkstra'); return {found:true, cost}; }

    for(const nb of neighbors4(cur)){
      if(closed.has(nb)) continue;
      const step = dist(cur, nb);
      const tentativeG = cur.g + step;
      if(tentativeG < nb.g){
        nb.parent = cur;
        nb.g = tentativeG;
        nb.h = (type==='astar') ? dist(nb,end) : 0;
        nb.f = nb.g + nb.h;
        if(!open.includes(nb)) open.push(nb);
      }
    }
  }
  return {found:false, cost:Infinity};
}

// ======= Pause support =======
async function waitIfPaused(){
  while(paused){ await sleep(40); }
}

// ======= Wiring =======
runBtn.addEventListener('click', run);
pauseBtn.addEventListener('click', ()=> paused = !paused );
resetBtn.addEventListener('click', ()=>{
  paused=false; running=false; clearVisitAndPath(); resetParents(); renderGrid(); metrics.algo='—'; metrics.visited=metrics.ms=0; metrics.cost=0; updateMetricsUI();
});
clearBtn.addEventListener('click', ()=>{ if(running) return; clearWalls(); clearVisitAndPath(); renderGrid(); });
randomBtn.addEventListener('click', ()=>{ if(running) return; clearVisitAndPath(); applyRandomWalls(); renderGrid(); });

modeStartBtn.addEventListener('click', ()=> setPaintMode('start'));
modeEndBtn.addEventListener('click', ()=> setPaintMode('end'));
modeWallBtn.addEventListener('click', ()=> setPaintMode('wall'));
modeEraseBtn.addEventListener('click', ()=> setPaintMode('erase'));

gridSizeSel.addEventListener('change', ()=>{
  const [r,c] = gridSizeSel.value.split('x').map(Number);
  rows=r; cols=c;
  buildGrid(); renderGrid(); clearVisitAndPath();
});

function init(){
  buildGrid(); renderGrid(); setPaintMode('wall'); updateMetricsUI();
}
init();
