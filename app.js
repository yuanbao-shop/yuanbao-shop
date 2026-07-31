/* ========= 元宝家婴童店工作台 ========= */
"use strict";

/* ---------- 1. 常量配置 ---------- */
// 衣服分类：连体衣、短袖、套装、外套、打底裤、打底衫、半裙、连衣裙
const CATEGORIES = [
  {key:'lian', name:'连体衣', cls:'t-lian', icon:'👶'},
  {key:'short', name:'短袖',   cls:'t-chun', icon:'👕'},
  {key:'set',  name:'套装',   cls:'t-fen',  icon:'🧥'},
  {key:'coat', name:'外套',   cls:'t-qiu',  icon:'🧸'},
  {key:'pants',name:'打底裤', cls:'t-xia',  icon:'👖'},
  {key:'base', name:'打底衫', cls:'t-dong', icon:'👚'},
  {key:'skirt',name:'半裙',   cls:'t-lian', icon:'🩳'},
  {key:'dress',name:'连衣裙', cls:'t-fen',  icon:'👗'},
];
// 尺码段：连体衣 59/66/73/80/90，分体 73-130
const SIZE_LIAN = ['59','66','73','80','90'];
const SIZE_FEN  = ['73','80','85','90','100','110','120','130'];
function sizesFor(catKey){
  return catKey==='lian' ? SIZE_LIAN : SIZE_FEN;
}
// 季节
const SEASONS = [
  {key:'chun',name:'春',cls:'t-chun',emoji:'🌸'},
  {key:'xia', name:'夏',cls:'t-xia', emoji:'☀️'},
  {key:'qiu', name:'秋',cls:'t-qiu', emoji:'🍂'},
  {key:'dong',name:'冬',cls:'t-dong',emoji:'❄️'},
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c=>[c.key,c]));
const SEA_MAP = Object.fromEntries(SEASONS.map(s=>[s.key,s]));

/* ---------- 2. 数据持久化（IndexedDB 优先，localStorage 降级）----------
   localStorage 在 iOS 仅约 5MB，照片 base64 极易写满触发 QuotaExceededError。
   改用 IndexedDB：单库 yuanbao，object store 'kv' 主键 'db' 存全部数据；
   容量上限通常数百 MB，足以保存成百上千带图商品。
*/
const DB = {
  products: [],   // {id,name,cat,season,color,sizes:{'73':2,...},cost,price,thumb,sold,createdAt}
  members:  [],   // {id,name,phone,points,referrerId}
  sales:    [],   // {id,memberId,items:[{pid,name,qty,price,cost}],total,profit,pointsEarned,time}
  redeems:  [],   // 兑换记录
  redeemItems: [  // 兑换奖品
    {id:'r1',name:'婴儿口水巾',cost:30,emoji:'🧺'},
    {id:'r2',name:'小袜子一双',cost:50,emoji:'🧦'},
    {id:'r3',name:'奶瓶(200ml)',cost:200,emoji:'🍼'},
    {id:'r4',name:'元宝家10元券',cost:100,emoji:'🎫'},
    {id:'r5',name:'婴儿湿巾一包',cost:80,emoji:'🧻'},
    {id:'r6',name:'玩具摇铃',cost:150,emoji:'🔔'},
  ],
};
const IDB = {
  db: null,
  ready: false,
  pending: [],
  open(){
    return new Promise((resolve)=>{
      if(this.ready && this.db){ resolve(this.db); return; }
      if(!('indexedDB' in window)){ resolve(null); return; }
      try{
        const r = indexedDB.open('yuanbao', 1);
        r.onupgradeneeded = e=>{ const db=e.target.result; if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); };
        r.onsuccess = e=>{ this.db=e.target.result; this.ready=true; this.flush(); resolve(this.db); };
        r.onerror = ()=>{ resolve(null); };
      }catch(err){ console.warn('idb open fail',err); resolve(null); }
    });
  },
  flush(){ while(this.pending.length){ const f=this.pending.shift(); try{f(this.db);}catch(e){} } },
  get(key){
    return new Promise(async (resolve)=>{
      const db = await this.open(); if(!db){ resolve(null); return; }
      try{
        const tx = db.transaction('kv','readonly').objectStore('kv').get(key);
        tx.onsuccess = ()=>resolve(tx.result||null);
        tx.onerror = ()=>resolve(null);
      }catch(e){ resolve(null); }
    });
  },
  set(key, val){
    return new Promise(async (resolve)=>{
      const db = await this.open(); if(!db){ resolve(false); return; }
      try{
        const tx = db.transaction('kv','readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = ()=>resolve(true);
        tx.onerror = ()=>resolve(false);
        tx.onabort = ()=>resolve(false);
      }catch(e){ console.warn('idb set fail',e); resolve(false); }
    });
  },
};
function load(){
  // 同步读取 localStorage 缓存的元数据（无图小副本，加快首屏）
  try{
    const s = localStorage.getItem('yuanbao_db_meta');
    if(s){ const d = JSON.parse(s); Object.assign(DB, d); }
  }catch(e){ console.warn('meta load fail',e); }
  // 异步从 IndexedDB 读取完整数据
  IDB.open().then(()=>{
    IDB.get('db').then(d=>{
      if(d){ Object.assign(DB, d); render(); }
    });
  });
}
let _saveTimer = null;
function save(){
  // 防抖：连续保存只写最后一次
  if(_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_doSave, 150);
}
function _doSave(){
  // 1) 写一份精简元数据到 localStorage（去掉 thumb 字段，避免 5MB 超限）
  try{
    const meta = JSON.parse(JSON.stringify(DB));
    if(meta.products){ meta.products = meta.products.map(p=>{ const c={...p}; delete c.thumb; return c; }); }
    localStorage.setItem('yuanbao_db_meta', JSON.stringify(meta));
  }catch(e){ console.warn('meta save fail',e); }
  // 2) 完整数据写 IndexedDB（含照片）
  IDB.set('db', DB).then(ok=>{
    if(!ok){
      // IndexedDB 失败兜底：尝试仅写文本数据到 localStorage
      try{
        const lite = JSON.parse(JSON.stringify(DB));
        if(lite.products) lite.products.forEach(p=>delete p.thumb);
        localStorage.setItem('yuanbao_db', JSON.stringify(lite));
      }catch(e2){ console.warn('fallback save fail',e2); }
    }
  });
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

/* ---------- 3. 工具 ---------- */
function $(sel,root){return (root||document).querySelector(sel);}
function $$(sel,root){return Array.from((root||document).querySelectorAll(sel));}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),1600); }
function money(n){ return '¥'+(Math.round(n*100)/100).toFixed(2); }
function fmtDate(ts){ const d=new Date(ts); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function esc(s){ return String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }

/* 存储容量估算：基于当前 DB 大小 + IndexedDB 配额查询（如浏览器支持）*/
function estStorage(){
  const usedBytes = new Blob([JSON.stringify(DB)]).size;
  const usedMB = (usedBytes/1024/1024).toFixed(1);
  // 估算还能存多少款（按平均每款含图 25KB）
  const avgPerSku = 25*1024;
  const remainSkus = Math.max(0, Math.floor((500*1024*1024 - usedBytes)/avgPerSku)); // 保守按 500MB 上限估
  return {usedMB, remainSkus, usedBytes};
}
/* navigator.storage.estimate() 异步查询真实配额 */
async function realStorageEstimate(){
  if(navigator.storage && navigator.storage.estimate){
    try{
      const r = await navigator.storage.estimate();
      return {quotaMB: (r.quota/1024/1024).toFixed(0), usageMB: (r.usage/1024/1024).toFixed(1)};
    }catch(e){ return null; }
  }
  return null;
}
/* 导出全部数据为 JSON 文件下载 */
function exportData(){
  const json = JSON.stringify(DB, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  a.download = `元宝家备份_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('✅ 备份文件已下载');
}
/* 从 JSON 文件导入数据 */
function importData(file){
  if(!file){ toast('请选择备份文件'); return; }
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const d = JSON.parse(e.target.result);
      if(!d.products || !Array.isArray(d.products)){ toast('文件格式不正确'); return; }
      if(!confirm(`即将导入：${d.products.length}款商品 / ${d.members?.length||0}位会员 / ${d.sales?.length||0}条销售\n此操作会覆盖当前数据，是否继续？`)) return;
      Object.assign(DB, d);
      if(!DB.redeemItems) DB.redeemItems = [
        {id:'r1',name:'婴儿口水巾',cost:30,emoji:'🧺'},
        {id:'r2',name:'小袜子一双',cost:50,emoji:'🧦'},
        {id:'r3',name:'奶瓶(200ml)',cost:200,emoji:'🍼'},
        {id:'r4',name:'元宝家10元券',cost:100,emoji:'🎫'},
        {id:'r5',name:'婴儿湿巾一包',cost:80,emoji:'🧻'},
        {id:'r6',name:'玩具摇铃',cost:150,emoji:'🔔'},
      ];
      save(); render(); toast('✅ 数据已导入');
    }catch(err){ toast('导入失败：'+err.message); }
  };
  reader.onerror = ()=>toast('读取文件失败');
  reader.readAsText(file);
}

/* ---------- 4. 图片压缩 ---------- */
// 从相册/文件选择 -> 自动压缩 -> base64
function compressImage(file, maxW, quality){
  maxW = maxW||600; quality = quality||0.7;
  return new Promise((resolve,reject)=>{
    if(!file || !file.type.startsWith('image/')){ reject(new Error('非图片文件')); return; }
    const reader = new FileReader();
    reader.onload = e=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.width, h = img.height;
        if(w > maxW){ h = Math.round(h*maxW/w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // 如果是 png 带透明，转 jpeg 会变黑底，这里统一 jpeg
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const kb = Math.round(dataUrl.length/1024*0.75);
        resolve({dataUrl, w, h, kb});
      };
      img.onerror = ()=>reject(new Error('图片解码失败'));
      img.src = e.target.result;
    };
    reader.onerror = ()=>reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/* ---------- 5. 导航 ---------- */
let curPage = 'dashboard';
function nav(page){
  curPage = page;
  $$('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  render();
}
$$('.nav-btn').forEach(b=>b.addEventListener('click', ()=>nav(b.dataset.page)));

/* ---------- 6. 页面渲染 ---------- */
function render(){
  const main = $('#main');
  const page = curPage;
  let html = '';
  if(page==='dashboard') html = renderDashboard();
  else if(page==='inventory') html = renderInventory();
  else if(page==='sale') html = renderSale();
  else if(page==='member') html = renderMember();
  else if(page==='points') html = renderPoints();
  else if(page==='redeem') html = renderRedeem();
  main.innerHTML = html;
  afterRender();
}

/* === 6.1 总览 === */
function renderDashboard(){
  const totalSku = DB.products.length;
  let totalStock=0, totalCostVal=0, totalSoldVal=0, totalProfit=0;
  DB.products.forEach(p=>{
    const stock = Object.values(p.sizes||{}).reduce((a,b)=>a+b,0);
    totalStock += stock;
    const costVal = stock * p.cost;
    totalCostVal += costVal;
    totalSoldVal += p.sold * p.price;
    totalProfit  += p.sold * (p.price - p.cost);
  });
  const memberCount = DB.members.length;
  return `
  <div class="page active">
    <div class="h-title">👶 元宝家 · 店铺总览 <span class="sub">${new Date().toLocaleDateString('zh-CN')}</span></div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="stat s-pink"><div class="k">在售款数</div><div class="v">${totalSku}</div><div class="emoji">👗</div></div>
      <div class="stat s-purple"><div class="k">总库存件</div><div class="v">${totalStock}</div><div class="emoji">📦</div></div>
    </div>
    <div class="grid2" style="margin-bottom:12px">
      <div class="stat s-mint"><div class="k">已售金额</div><div class="v">${money(totalSoldVal)}</div><div class="emoji">💰</div></div>
      <div class="stat s-yellow"><div class="k">累计利润</div><div class="v">${money(totalProfit)}</div><div class="emoji">📈</div></div>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">📊 库存成本</div>
      <div class="sum-line"><span>当前库存拿货成本</span><b>${money(totalCostVal)}</b></div>
      <div class="sum-line"><span>会员人数</span><b>${memberCount} 人</b></div>
      <div class="sum-total"><span>毛利润合计</span><span style="color:#059669">${money(totalProfit)}</span></div>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">💾 存储容量 <span class="sub" id="storageSub">计算中…</span></div>
      <div id="storageInfo"><div class="sum-line"><span>已用空间</span><b>${estStorage().usedMB} MB</b></div><div class="sum-line"><span>预计还可录入</span><b>${estStorage().remainSkus} 款商品</b></div></div>
      <div class="prod-bar" style="margin-top:8px">
        <button class="btn btn-mint btn-sm" onclick="exportData()">📤 导出备份</button>
        <button class="btn btn-purple btn-sm" onclick="document.getElementById('importFile').click()">📥 导入恢复</button>
        <input type="file" id="importFile" accept=".json,application/json" style="display:none" onchange="importData(this.files[0])">
      </div>
      <div style="font-size:11px;color:var(--ink-soft);margin-top:8px;line-height:1.5">💡 存储改用 IndexedDB，支持 1000+ 款商品。建议每周「导出备份」一次到手机文件，防止误删。</div>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">⚡ 快捷操作</div>
      <div class="grid2">
        <button class="btn btn-primary" onclick="openAddProduct()">➕ 添加商品</button>
        <button class="btn btn-purple" onclick="nav('sale')">💰 收银记账</button>
        <button class="btn btn-mint" onclick="nav('redeem')">🎟️ 积分兑换</button>
        <button class="btn btn-yellow" onclick="nav('member')">💝 会员管理</button>
      </div>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">🎉 近期销售</div>
      ${DB.sales.slice(-5).reverse().map(s=>`
        <div class="row">
          <div><div class="v" style="font-size:13px">${esc(s.memberName||'散客')} · ${s.items.length}件</div><div class="k" style="font-size:11px">${fmtDate(s.time)} · 得${s.pointsEarned}分</div></div>
          <div style="text-align:right"><div class="v" style="color:var(--pink)">${money(s.total)}</div><div class="k" style="font-size:11px">利${money(s.profit)}</div></div>
        </div>`).join('') || '<div class="empty"><span class="emoji">🛒</span>暂无销售记录</div>'}
    </div>
  </div>`;
}

/* === 6.2 商品库存 === */
let invFilter = {cat:'', season:'', q:''};
function renderInventory(){
  let list = DB.products.slice();
  if(invFilter.cat) list = list.filter(p=>p.cat===invFilter.cat);
  if(invFilter.season) list = list.filter(p=>p.season===invFilter.season);
  if(invFilter.q){
    const q = invFilter.q.toLowerCase();
    list = list.filter(p=> (p.name||'').toLowerCase().includes(q)
                        || (p.code||'').toLowerCase().includes(q)
                        || (p.color||'').toLowerCase().includes(q));
  }
  const catChips = CATEGORIES.map(c=>`<div class="chip ${invFilter.cat===c.key?'active':''}" onclick="setInvFilter('cat','${c.key}')">${c.icon}${c.name}</div>`).join('');
  const seaChips = SEASONS.map(s=>`<div class="chip ${invFilter.season===s.key?'active':''}" onclick="setInvFilter('season','${s.key}')">${s.emoji}${s.name}</div>`).join('');
  return `
  <div class="page active">
    <div class="h-title">👗 商品库存 <span class="sub">${list.length}款</span></div>
    <button class="btn btn-primary btn-block" onclick="openAddProduct()" style="margin-bottom:12px">➕ 添加新商品（可传照片）</button>

    <div class="card" style="padding:10px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input id="invSearch" placeholder="🔍 搜款号/名称/颜色…" value="${esc(invFilter.q||'')}" oninput="onInvSearch(this.value)" style="flex:1">
        <button class="btn btn-purple btn-sm" style="flex-shrink:0" onclick="openPhotoSearch('inv')" title="拍照识别">📷</button>
      </div>
      <label>分类筛选</label>
      <div class="chips">${catChips}<div class="chip ${invFilter.cat===''?'active':''}" onclick="setInvFilter('cat','')">全部</div></div>
    </div>
    <div class="card" style="padding:10px;margin-top:-4px">
      <label>季节筛选</label>
      <div class="chips">${seaChips}<div class="chip ${invFilter.season===''?'active':''}" onclick="setInvFilter('season','')">全部</div></div>
      ${(invFilter.cat||invFilter.season||invFilter.q) ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="clearInvFilter()">🗑️ 清除筛选</button>` : ''}
    </div>

    ${list.length===0 ? `<div class="empty"><span class="emoji">🧸</span>还没有商品<br>点上方按钮添加第一款吧～</div>` :
      list.map(p=>{
        const cat = CAT_MAP[p.cat]||{name:'?',cls:'',icon:'🏷️'};
        const sea = SEA_MAP[p.season]||{emoji:'',cls:'',name:''};
        const stock = Object.values(p.sizes||{}).reduce((a,b)=>a+b,0);
        const sizesTxt = Object.entries(p.sizes||{}).filter(([k,v])=>v>0).map(([k,v])=>`${k}码×${v}`).join(' / ') || '无库存';
        const costVal = stock*p.cost;
        return `
        <div class="prod-item">
          <button class="icon-x" onclick="delProduct('${p.id}')" title="删除">✕</button>
          <img class="prod-thumb" src="${p.thumb||''}" onerror="this.style.display='none'" alt="">
          <div class="prod-info">
            <div class="prod-name">
              ${cat.icon} ${esc(p.name)}
              <span class="tag ${cat.cls}">${cat.name}</span>
              <span class="tag ${sea.cls}">${sea.emoji}${sea.name}</span>
            </div>
            <div class="prod-meta">款号: ${esc(p.code||'-')} · ${esc(p.color||'')} ${p.color?'·':''} 拿${money(p.cost)} / 卖${money(p.price)}</div>
            <div class="prod-meta">尺码: ${sizesTxt}</div>
            <div class="prod-bar">
              <span class="pill" style="background:#E6FFF6;color:#059669">剩余 ${stock}件</span>
              <span class="pill" style="background:#FFF8E1;color:#B45309">已售 ${p.sold}件</span>
              <span class="pill" style="background:#EFF6FF;color:#0284C7">库存成本 ${money(costVal)}</span>
            </div>
            <div class="prod-bar">
              <button class="btn btn-ghost btn-sm" onclick="openRestock('${p.id}')">📥 补货</button>
              <button class="btn btn-mint btn-sm" onclick="openEditProd('${p.id}')">✏️ 编辑</button>
            </div>
          </div>
        </div>`;
      }).join('')
    }
  </div>`;
}
function setInvFilter(k,v){ invFilter[k]=v; render(); }
function clearInvFilter(){ invFilter={cat:'',season:'',q:''}; render(); }
let _invSearchTimer = null;
function onInvSearch(v){
  if(_invSearchTimer) clearTimeout(_invSearchTimer);
  _invSearchTimer = setTimeout(()=>{ invFilter.q = v.trim(); render(); const inp=$('#invSearch'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 250);
}

/* === 添加/编辑商品 Modal === */
let editState = null; // {id, photoData}
function openAddProduct(){ editState={id:null,photoData:null}; showProductModal(null); }
function openEditProd(id){ const p=DB.products.find(x=>x.id===id); if(p){ editState={id:id,photoData:p.thumb}; showProductModal(p);} }
function showProductModal(p){
  const isEdit = !!p;
  const formSizes = p ? p.sizes : {};
  const formCat = p ? p.cat : 'lian';
  const sizeList = sizesFor(formCat);
  const sizeHtml = sizeList.map(s=>`<div class="size-opt ${formSizes[s]?'active':''}" data-size="${s}" onclick="toggleSize(this)">${s}</div>`).join('');
  $('#modalBox').innerHTML = `
    <div class="modal-head">
      <h3>${isEdit?'✏️ 编辑商品':'➕ 添加商品'}</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="field">
      <label>商品照片（可从相册选择，自动压缩）</label>
      <div class="photo-up" id="photoUp" onclick="$('#photoInput').click()">
        ${editState.photoData ? `<img src="${editState.photoData}" alt="">` : `<span style="font-size:30px">📷</span><div style="font-weight:700">点击上传照片</div><div class="tip">支持相册选择 · 自动压缩</div>`}
      </div>
      <input type="file" id="photoInput" accept="image/*" style="display:none" onchange="onPhotoPick(event)">
      ${editState.photoData ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="clearPhoto()">🗑️ 移除照片</button>` : ''}
    </div>
    <div class="grid2">
      <div class="field"><label>款号</label><input id="f_code" placeholder="如 YB001" value="${esc(p?.code||'')}"></div>
      <div class="field"><label>商品名称</label><input id="f_name" placeholder="如 纯棉连体衣" value="${esc(p?.name||'')}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>拿货价</label><input id="f_cost" type="number" inputmode="decimal" placeholder="0.00" value="${p?.cost||''}"></div>
      <div class="field"><label>卖价</label><input id="f_price" type="number" inputmode="decimal" placeholder="0.00" value="${p?.price||''}"></div>
    </div>
    <div class="field">
      <label>衣服分类</label>
      <select id="f_cat" onchange="onCatChange()">
        ${CATEGORIES.map(c=>`<option value="${c.key}" ${formCat===c.key?'selected':''}>${c.icon} ${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>季节</label>
      <div class="chips" id="seasonChips">
        ${SEASONS.map(s=>`<div class="chip ${p?.season===s.key?'active':''}" data-sea="${s.key}" onclick="pickSea(this)">${s.emoji}${s.name}</div>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>颜色</label>
      <input id="f_color" placeholder="如 奶白/粉色" value="${esc(p?.color||'')}">
    </div>
    <div class="field">
      <label>尺码库存（点击选择尺码，同一尺码可多次点 +1）</label>
      <div class="size-grid" id="sizeGrid">${sizeHtml}</div>
      <div id="sizeQty" style="margin-top:8px"></div>
    </div>
    <div class="grid2">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveProduct()">💾 ${isEdit?'保存修改':'添加商品'}</button>
    </div>
  `;
  refreshSizeQty();
  $('#modalMask').classList.add('show');
}
function closeModal(){ $('#modalMask').classList.remove('show'); editState=null; }
$('#modalMask').addEventListener('click', e=>{ if(e.target.id==='modalMask') closeModal(); });

function toggleSize(el){
  if(el.classList.contains('active')){
    // 同一尺码再次点击 = 数量 +1（不允许取消，只能用 - 按钮减）
    const q = parseInt(el.dataset.qty||'1') + 1;
    el.dataset.qty = q;
  }else{
    el.classList.add('active');
    if(!el.dataset.qty) el.dataset.qty='1';
  }
  refreshSizeQty();
}
function refreshSizeQty(){
  const grid = $('#sizeGrid'); if(!grid) return;
  $$('.size-opt.active', grid).forEach(opt=>{
    if(!opt.dataset.qty) opt.dataset.qty='1';
  });
  const items = $$('.size-opt.active', grid);
  const box = $('#sizeQty');
  if(items.length===0){ box.innerHTML='<div style="font-size:11px;color:#999">未选择尺码</div>'; return; }
  box.innerHTML = items.map(opt=>{
    const s = opt.dataset.size;
    const q = parseInt(opt.dataset.qty||'1');
    return `<div class="row" style="padding:6px 0">
      <span class="v">${s}码</span>
      <span style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="adjQty('${s}',-1)">−</button>
        <input type="number" value="${q}" style="width:60px;text-align:center;padding:6px" onchange="setQty('${s}',this.value)">
        <button class="btn btn-mint btn-sm" onclick="adjQty('${s}',1)">+</button>
        <button class="btn btn-danger btn-sm" onclick="removeSize('${s}')" title="移除该尺码">✕</button>
      </span>
    </div>`;
  }).join('');
}
function removeSize(s){
  const el=$(`.size-opt[data-size="${s}"]`); if(!el)return;
  el.classList.remove('active'); delete el.dataset.qty;
  refreshSizeQty();
}
function adjQty(s,d){ const el=$(`.size-opt[data-size="${s}"]`); if(!el)return; let q=parseInt(el.dataset.qty||'1')+d; if(q<1)q=1; el.dataset.qty=q; refreshSizeQty(); }
function setQty(s,v){ const el=$(`.size-opt[data-size="${s}"]`); if(!el)return; let q=parseInt(v)||1; if(q<1)q=1; el.dataset.qty=q; refreshSizeQty(); }
function pickSea(el){ $$('#seasonChips .chip').forEach(c=>c.classList.remove('active')); el.classList.add('active'); }
function onCatChange(){
  const cat = $('#f_cat').value;
  const sizeList = sizesFor(cat);
  $('#sizeGrid').innerHTML = sizeList.map(s=>`<div class="size-opt" data-size="${s}" onclick="toggleSize(this)">${s}</div>`).join('');
  refreshSizeQty();
}
function clearPhoto(){ editState.photoData=null; showProductModal(editState.id?DB.products.find(p=>p.id===editState.id):null); }

async function onPhotoPick(e){
  const file = e.target.files[0];
  if(!file) return;
  toast('压缩中…');
  try{
    const r = await compressImage(file, 400, 0.65);  // 录入用更激进压缩，单图~20KB，1000款仅~20MB
    editState.photoData = r.dataUrl;
    const up = $('#photoUp');
    up.innerHTML = `<img src="${r.dataUrl}">`;
    toast(`已压缩 ${r.w}×${r.h} · ${r.kb}KB`);
  }catch(err){ toast('图片上传失败：'+err.message); }
}

function saveProduct(){
  const code = $('#f_code').value.trim();
  const name = $('#f_name').value.trim();
  const cost = parseFloat($('#f_cost').value)||0;
  const price = parseFloat($('#f_price').value)||0;
  const cat = $('#f_cat').value;
  const color = $('#f_color').value.trim();
  const seaEl = $('#seasonChips .chip.active');
  const season = seaEl ? seaEl.dataset.sea : '';
  const sizes = {};
  $$('.size-opt.active').forEach(opt=>{ sizes[opt.dataset.size] = parseInt(opt.dataset.qty||'1'); });
  if(!name){ toast('请填写商品名称'); return; }
  if(!season){ toast('请选择季节'); return; }
  if(cost<=0){ toast('请填写拿货价'); return; }
  if(price<=0){ toast('请填写卖价'); return; }
  if(Object.keys(sizes).length===0){ toast('请至少选择一个尺码'); return; }
  if(editState.id){
    const p = DB.products.find(x=>x.id===editState.id);
    Object.assign(p, {code,name,cost,price,cat,color,season,sizes,thumb:editState.photoData});
    toast('✅ 已更新');
  }else{
    DB.products.push({id:uid(),code,name,cost,price,cat,color,season,sizes,thumb:editState.photoData,sold:0,createdAt:Date.now()});
    toast('✅ 已添加');
  }
  save(); closeModal(); render();
}

function delProduct(id){
  const p = DB.products.find(x=>x.id===id);
  if(!p) return;
  if(confirm(`确认删除「${p.name}」？此操作不可撤销。`)){
    DB.products = DB.products.filter(x=>x.id!==id);
    save(); render(); toast('🗑️ 已删除');
  }
}

/* 补货 */
function openRestock(id){
  const p = DB.products.find(x=>x.id===id);
  if(!p) return;
  const sizeList = sizesFor(p.cat);
  $('#modalBox').innerHTML = `
    <div class="modal-head"><h3>📥 补货 · ${esc(p.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="field">
      <label>补充各尺码数量（填0或不填表示不补）</label>
      ${sizeList.map(s=>`<div class="row"><span class="v">${s}码</span><input type="number" min="0" value="0" data-rs="${s}" style="width:90px;text-align:center"></div>`).join('')}
    </div>
    <div class="grid2">
      <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn btn-mint" onclick="doRestock('${id}')">确认补货</button>
    </div>`;
  $('#modalMask').classList.add('show');
}
function doRestock(id){
  const p = DB.products.find(x=>x.id===id);
  let added=0;
  $$('[data-rs]').forEach(inp=>{ const s=inp.dataset.rs; const n=parseInt(inp.value)||0; if(n>0){ p.sizes[s]=(p.sizes[s]||0)+n; added+=n; } });
  save(); closeModal(); render(); toast(`已补货 ${added} 件`);
}

/* === 6.3 收银 === */
let cart = []; // {pid,name,qty,price,cost,size}
let saleMemberId = '';
let saleFilter = {cat:'', season:'', q:''};   // 收银页商品筛选（含搜索关键字）
function renderSale(){
  // 应用筛选 + 搜索后的商品列表
  let list = DB.products.slice();
  if(saleFilter.cat) list = list.filter(p=>p.cat===saleFilter.cat);
  if(saleFilter.season) list = list.filter(p=>p.season===saleFilter.season);
  if(saleFilter.q){
    const q = saleFilter.q.toLowerCase();
    list = list.filter(p=> (p.name||'').toLowerCase().includes(q)
                        || (p.code||'').toLowerCase().includes(q)
                        || (p.color||'').toLowerCase().includes(q));
  }
  // 筛选 chips
  const catChips = CATEGORIES.map(c=>`<div class="chip chip-small ${saleFilter.cat===c.key?'active':''}" onclick="setSaleFilter('cat','${c.key}')">${c.icon}${c.name}</div>`).join('');
  const seaChips = SEASONS.map(s=>`<div class="chip chip-small ${saleFilter.season===s.key?'active':''}" onclick="setSaleFilter('season','${s.key}')">${s.emoji}${s.name}</div>`).join('');
  const hasFilter = saleFilter.cat || saleFilter.season || saleFilter.q;
  return `
  <div class="page active">
    <div class="h-title">💰 收银记账</div>
    <div class="card">
      <label>会员（可选，享积分）</label>
      <select id="saleMember" onchange="saleMemberId=this.value">
        <option value="">散客（不计积分）</option>
        ${DB.members.map(m=>`<option value="${m.id}" ${saleMemberId===m.id?'selected':''}>${esc(m.name)} - ${esc(m.phone)} (${m.points}分)</option>`).join('')}
      </select>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">🛒 购物车 ${cart.length?'· '+cart.reduce((a,b)=>a+b.qty,0)+'件':''}</div>
      ${cart.length===0 ? '<div class="empty" style="padding:20px"><span class="emoji">🧺</span>购物车空空如也</div>' :
        cart.map((it,i)=>`
        <div class="row" style="flex-wrap:wrap">
          <div style="flex:1;min-width:120px"><div class="v" style="font-size:13px">${esc(it.name)} (${it.size}码)</div><div class="k" style="font-size:11px">定价 ${money(it.price)} · 拿货 ${money(it.cost)}</div></div>
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="cartQty(${i},-1)">−</button>
            <span class="big-num" style="font-size:14px">${it.qty}</span>
            <button class="btn btn-mint btn-sm" onclick="cartQty(${i},1)">+</button>
            <button class="btn btn-danger btn-sm" onclick="cartDel(${i})">✕</button>
          </div>
          <div style="width:100%;margin-top:6px;display:flex;align-items:center;gap:6px">
            <span style="font-size:11px;color:var(--ink-soft);font-weight:700">实收单价</span>
            <input type="number" inputmode="decimal" value="${it.actual!=null?it.actual:it.price}" step="0.01" min="0" onchange="setActual(${i},this.value)" oninput="setActual(${i},this.value)" style="width:90px;padding:6px 8px;font-size:13px">
            <span style="font-size:11px;color:var(--ink-soft)">元</span>
            ${it.actual!=null && it.actual<it.price ? `<span class="pill" style="background:#FFE0E0;color:#E63946">优惠${money(it.price-it.actual)}</span>` : ''}
          </div>
        </div>`).join('')
      }
      ${cart.length ? `<div class="sum-total"><span>实收合计</span><span style="color:var(--pink)">${money(cart.reduce((a,b)=>a+(b.actual!=null?b.actual:b.price)*b.qty,0))}</span></div>` : ''}
    </div>
    ${cart.length ? `<button class="btn btn-primary btn-block" onclick="checkout()">💳 结算</button>` : ''}
    <div class="card" style="margin-top:12px">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">📦 选择商品 <span class="sub">${list.length}款可选</span></div>
      ${DB.products.length===0 ? '<div class="empty"><span class="emoji">📦</span>请先去「商品」页添加</div>' : `
      <div style="margin-bottom:10px;padding:10px;background:var(--pink-bg);border-radius:14px">
        <div style="display:flex;gap:8px;align-items:center">
          <input id="saleSearch" placeholder="🔍 搜款号/名称/颜色…" value="${esc(saleFilter.q||'')}" oninput="onSaleSearch(this.value)" style="flex:1">
          <button class="btn btn-purple btn-sm" style="flex-shrink:0" onclick="openPhotoSearch('sale')" title="拍照识别">📷</button>
        </div>
        <label style="margin:8px 0 4px">🔍 分类筛选</label>
        <div class="chips">${catChips}<div class="chip chip-small ${saleFilter.cat===''?'active':''}" onclick="setSaleFilter('cat','')">全部</div></div>
        <label style="margin:6px 0 4px">🌿 季节筛选</label>
        <div class="chips">${seaChips}<div class="chip chip-small ${saleFilter.season===''?'active':''}" onclick="setSaleFilter('season','')">全部</div></div>
        ${hasFilter ? `<button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="clearSaleFilter()">🗑️ 清除筛选</button>` : ''}
      </div>
      ${list.length===0 ? '<div class="empty" style="padding:20px"><span class="emoji">🔍</span>该筛选下无商品</div>' :
        list.map(p=>{
          const stock = Object.values(p.sizes||{}).reduce((a,b)=>a+b,0);
          const hasSizes = Object.entries(p.sizes||{}).filter(([k,v])=>v>0);
          const cat = CAT_MAP[p.cat]||{name:'',cls:'',icon:''};
          const sea = SEA_MAP[p.season]||{emoji:'',cls:'',name:''};
          return `<div class="prod-item">
            <img class="prod-thumb" src="${p.thumb||''}" onerror="this.style.display='none'">
            <div class="prod-info">
              <div class="prod-name">${cat.icon} ${esc(p.name)} <span class="tag ${cat.cls}">${cat.name}</span><span class="tag ${sea.cls}">${sea.emoji}${sea.name}</span> <span class="pill" style="background:#E6FFF6;color:#059669">余${stock}</span></div>
              <div class="prod-meta">卖${money(p.price)} · 拿${money(p.cost)}</div>
              <div class="prod-bar">
                ${hasSizes.length ? hasSizes.map(([s,v])=>`<button class="btn btn-purple btn-sm" onclick="addToCart('${p.id}','${s}')">${s}码(余${v})</button>`).join('') : '<span style="font-size:11px;color:#999">无库存，请补货</span>'}
              </div>
            </div>
          </div>`;
        }).join('')
      }`}
    </div>
  </div>`;
}
function setSaleFilter(k,v){ saleFilter[k]=v; render(); }
function clearSaleFilter(){ saleFilter={cat:'',season:'',q:''}; render(); }
let _saleSearchTimer = null;
function onSaleSearch(v){
  // 防抖 250ms，避免每次输入都重渲染抖动
  if(_saleSearchTimer) clearTimeout(_saleSearchTimer);
  _saleSearchTimer = setTimeout(()=>{ saleFilter.q = v.trim(); render(); /* 还原输入框光标位置 */ const inp=$('#saleSearch'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 250);
}
/* 拍照识别 / 图片搜索：拍一张商品照片，自动匹配库存中视觉最相似的商品。
   实现思路：将上传图片与已有商品缩略图做感知哈希对比，取汉明距离最小的为结果。
   若无照片库或匹配度过高，回退到名称关键字搜索 modal。
   页面来源：'sale' / 'inv'。
*/
function openPhotoSearch(from){
  if(DB.products.filter(p=>p.thumb).length===0){
    toast('暂无带图商品，请先在「商品」页录入照片');
    // 直接聚焦搜索框
    const inp = from==='sale' ? $('#saleSearch') : $('#invSearch');
    if(inp) inp.focus();
    return;
  }
  // 弹出拍照/选图 modal
  $('#modalBox').innerHTML = `
    <div class="modal-head"><h3>📷 拍照识别商品</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="card" style="background:var(--purple-bg);margin-bottom:12px">
      <div style="font-size:12px;line-height:1.6;color:var(--ink-soft)">拍一张或从相册选一张商品照片，自动匹配库存中视觉最相似的商品。匹配后可一键加入购物车 / 跳转编辑。</div>
    </div>
    <div class="photo-up" id="searchPhotoUp" onclick="$('#searchPhotoInput').click()" style="margin-bottom:12px">
      <span style="font-size:32px">📸</span>
      <div style="font-weight:700">点这里拍照 / 选图</div>
      <div class="tip">系统会自动压缩并比对</div>
    </div>
    <input type="file" id="searchPhotoInput" accept="image/*" capture="environment" style="display:none" onchange="onSearchPhoto(event,'${from}')">
    <div id="searchResult"></div>
    <button class="btn btn-ghost btn-block" onclick="closeModal()">关闭</button>
  `;
  $('#modalMask').classList.add('show');
}
async function onSearchPhoto(e, from){
  const file = e.target.files[0];
  if(!file) return;
  const up = $('#searchPhotoUp');
  up.innerHTML = `<span style="font-size:28px">⏳</span><div>识别中…</div>`;
  try{
    const r = await compressImage(file, 200, 0.5); // 用更小的尺寸便于哈希
    const inputHash = await phash(r.dataUrl);
    // 与所有带图商品对比
    const candidates = [];
    for(const p of DB.products){
      if(!p.thumb) continue;
      try{
        const h = await phash(p.thumb);
        const dist = hamming(inputHash, h);
        candidates.push({p, dist});
      }catch(err){}
    }
    candidates.sort((a,b)=>a.dist-b.dist);
    const best = candidates[0];
    const result = $('#searchResult');
    if(!best || best.dist > 25){
      // 相似度太低，提示用名称搜
      result.innerHTML = `<div class="empty"><span class="emoji">🤔</span>未找到匹配商品<br>请用上方搜索框输入名称/款号查找</div>`;
      up.innerHTML = `<span style="font-size:30px">📷</span><div style="font-weight:700">重新拍照</div>`;
      return;
    }
    const p = best.p;
    const cat = CAT_MAP[p.cat]||{name:'',cls:'',icon:''};
    const sea = SEA_MAP[p.season]||{emoji:'',cls:'',name:''};
    const stock = Object.values(p.sizes||{}).reduce((a,b)=>a+b,0);
    const sim = Math.max(0, Math.round((1 - best.dist/64) * 100));
    result.innerHTML = `
      <div style="font-size:12px;color:var(--ink-soft);margin:6px 0 8px">相似度 <b style="color:var(--purple)">${sim}%</b></div>
      <div class="prod-item">
        <img class="prod-thumb" src="${p.thumb}">
        <div class="prod-info">
          <div class="prod-name">${cat.icon} ${esc(p.name)} <span class="tag ${cat.cls}">${cat.name}</span><span class="tag ${sea.cls}">${sea.emoji}${sea.name}</span></div>
          <div class="prod-meta">款号 ${esc(p.code||'-')} · 卖${money(p.price)} · 余${stock}</div>
          <div class="prod-bar">
            ${from==='sale' ? (stock>0 ? Object.entries(p.sizes).filter(([k,v])=>v>0).map(([s,v])=>`<button class="btn btn-mint btn-sm" onclick="photoPickAdd('${p.id}','${s}')">${s}码</button>`).join('') : '<span style="font-size:11px;color:#E63946">无库存</span>') : `<button class="btn btn-purple btn-sm" onclick="photoPickEdit('${p.id}')">✏️ 编辑</button>`}
          </div>
        </div>
      </div>`;
    up.innerHTML = `<img src="${r.dataUrl}"><div class="tip" style="position:absolute;bottom:4px;left:0;right:0;text-align:center;background:rgba(0,0,0,.4);color:#fff;border-radius:0 0 14px 14px;padding:2px">已识别 · 可重拍</div>`;
  }catch(err){
    up.innerHTML = `<span style="font-size:30px">📷</span><div style="font-weight:700">重试</div>`;
    toast('识别失败：'+err.message);
  }
}
function photoPickAdd(pid, size){
  // 关闭 modal 后调 addToCart
  closeModal();
  // 确保在收银页
  if(curPage!=='sale') nav('sale');
  addToCart(pid, size);
}
function photoPickEdit(pid){
  closeModal();
  if(curPage!=='inventory') nav('inventory');
  openEditProd(pid);
}
/* 感知哈希：缩成 16x16 灰度图 → 取平均 → 每位与平均比较 */
function phash(dataUrl){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>{
      const size = 16;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0,0,size,size).data;
      const grays = [];
      for(let i=0;i<data.length;i+=4){ grays.push((data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)); }
      const avg = grays.reduce((a,b)=>a+b,0)/grays.length;
      let hash = '';
      for(const g of grays){ hash += (g>=avg?'1':'0'); }
      resolve(hash);
    };
    img.onerror = ()=>reject(new Error('图片解码失败'));
    img.src = dataUrl;
  });
}
function hamming(a,b){
  if(a.length!==b.length) return 64;
  let d = 0;
  for(let i=0;i<a.length;i++){ if(a[i]!==b[i]) d++; }
  return d;
}
function addToCart(pid, size){
  const p = DB.products.find(x=>x.id===pid);
  if(!p) return;
  if((p.sizes[size]||0) <= 0){ toast('该尺码无库存'); return; }
  const ex = cart.find(c=>c.pid===pid && c.size===size);
  if(ex){
    if(ex.qty >= (p.sizes[size]||0)){ toast('超过库存'); return; }
    ex.qty++;
  }else{
    cart.push({pid, name:p.name, size, qty:1, price:p.price, cost:p.cost, actual:p.price});  // actual=实际成交单价，默认=定价
  }
  render();
}
function cartQty(i,d){ cart[i].qty+=d; if(cart[i].qty<=0) cart.splice(i,1); render(); }
function cartDel(i){ cart.splice(i,1); render(); }
// 设置实际成交单价（顾客讨价还价后便宜了）
function setActual(i,v){
  const n = parseFloat(v);
  if(!isNaN(n) && n>=0){ cart[i].actual = n; }
  // 不立即 render 避免输入框失焦，只更新合计
  const total = cart.reduce((a,b)=>a+(b.actual!=null?b.actual:b.price)*b.qty,0);
  const st = document.querySelector('.sum-total span:last-child');
  if(st) st.textContent = money(total);
  // 更新优惠标签
  const row = document.querySelectorAll('.card .row')[i];
  if(row){
    const pill = row.querySelector('.pill');
    const diff = (cart[i].price||0) - (cart[i].actual!=null?cart[i].actual:cart[i].price);
    if(diff>0){
      if(pill){ pill.textContent = '优惠'+money(diff); pill.style.display=''; }
      else {
        const wrap = row.querySelector('div:last-child');
        if(wrap){ const p=document.createElement('span'); p.className='pill'; p.style.cssText='background:#FFE0E0;color:#E63946'; p.textContent='优惠'+money(diff); wrap.appendChild(p); }
      }
    } else if(pill){ pill.style.display='none'; }
  }
}

function checkout(){
  if(cart.length===0){ toast('购物车为空'); return; }
  // 实际成交总价 + 实际利润（用 actual 算）
  const total = cart.reduce((a,b)=>a+(b.actual!=null?b.actual:b.price)*b.qty,0);
  const profit = cart.reduce((a,b)=>a+((b.actual!=null?b.actual:b.price)-b.cost)*b.qty,0);
  const mid = saleMemberId;
  const member = mid ? DB.members.find(m=>m.id===mid) : null;
  // 积分规则：本人消费1元得1分（按实际成交价）
  let pointsEarned = 0;
  let referrerBonus = 0;
  if(member){
    pointsEarned = Math.floor(total); // 1元=1分
    member.points += pointsEarned;
    // 介绍人 +0.5分（取整后加，保留小数）
    if(member.referrerId){
      const ref = DB.members.find(m=>m.id===member.referrerId);
      if(ref){ ref.points = Math.round((ref.points + total*0.5)*10)/10; referrerBonus = Math.round(total*0.5*10)/10; }
    }
  }
  // 扣库存 + 增加已售
  cart.forEach(it=>{
    const p = DB.products.find(x=>x.id===it.pid);
    if(p){
      p.sizes[it.size] = Math.max(0,(p.sizes[it.size]||0) - it.qty);
      p.sold = (p.sold||0) + it.qty;
    }
  });
  DB.sales.push({
    id:uid(), memberId:mid, memberName:member?member.name:'散客',
    items:cart.map(c=>({pid:c.pid,name:c.name,qty:c.qty,price:c.price,actual:c.actual!=null?c.actual:c.price,cost:c.cost,size:c.size})),
    total, profit, pointsEarned, referrerBonus, time:Date.now()
  });
  cart = []; saleMemberId='';
  save(); render();
  toast(member ? `✅ 成交${money(total)} · 得${pointsEarned}分${referrerBonus?` · 介绍人+${referrerBonus}分`:''}` : `✅ 成交 ${money(total)}`);
}

/* === 6.4 会员 === */
let memberTab = 'list';
function renderMember(){
  return `
  <div class="page active">
    <div class="h-title">💝 会员管理</div>
    <div class="seg">
      <button class="${memberTab==='list'?'active':''}" onclick="memberTab='list';render()">会员列表</button>
      <button class="${memberTab==='add'?'active':''}" onclick="memberTab='add';render()">添加会员</button>
      <button class="${memberTab==='rule'?'active':''}" onclick="memberTab='rule';render()">积分规则</button>
    </div>
    ${memberTab==='list' ? `
      <button class="btn btn-purple btn-block" onclick="memberTab='add';render()" style="margin-bottom:10px">➕ 添加新会员</button>
      ${DB.members.length===0?'<div class="empty"><span class="emoji">💝</span>还没有会员</div>':
        DB.members.map(m=>`
        <div class="card" style="padding:12px">
          <div style="display:flex;gap:10px;align-items:center">
            <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#FF6FA5,#A78BFA);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">${esc(m.name[0]||'?')}</div>
            <div style="flex:1">
              <div style="font-weight:800">${esc(m.name)} ${m.referrerId?'<span class="tag t-chun">已介绍</span>':''}</div>
              <div style="font-size:11px;color:#7A5C8A">${esc(m.phone||'无电话')}</div>
            </div>
            <div style="text-align:right">
              <div class="big-num" style="color:var(--pink)">${m.points}</div>
              <div style="font-size:10px;color:#999">积分</div>
            </div>
          </div>
          <div class="prod-bar">
            <button class="btn btn-ghost btn-sm" onclick="adjustPoints('${m.id}')">🔧 调整积分</button>
            <button class="btn btn-danger btn-sm" onclick="delMember('${m.id}')">删除</button>
          </div>
        </div>`).join('')
      }` : ''}
    ${memberTab==='add' ? `
      <div class="card">
        <div class="field"><label>会员姓名</label><input id="m_name" placeholder="宝宝妈妈姓名"></div>
        <div class="field"><label>手机号</label><input id="m_phone" type="tel" placeholder="13800000000"></div>
        <div class="field">
          <label>介绍人（可选，介绍人按消费额0.5分/元得积分）</label>
          <select id="m_ref">
            <option value="">无介绍人</option>
            ${DB.members.map(m=>`<option value="${m.id}">${esc(m.name)} - ${esc(m.phone)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary btn-block" onclick="addMember()">💾 添加会员</button>
      </div>
      <div class="card" style="background:linear-gradient(135deg,#FFF8E1,#FFE0EC)">
        <div style="font-weight:800;margin-bottom:6px">📌 积分规则说明</div>
        <div style="font-size:12px;line-height:1.7;color:#7A5C8A">
          • 本人消费：<b>1元 = 1积分</b><br>
          • 介绍朋友消费：朋友本人得 <b>1分/元</b>，介绍人得 <b>0.5分/元</b><br>
          • 积分可在「兑换」页面核销奖品
        </div>
      </div>` : ''}
    ${memberTab==='rule' ? `
      <div class="card" style="background:linear-gradient(135deg,#FFF8E1,#FFE0EC)">
        <div class="h-title" style="font-size:15px">📋 元宝家积分规则</div>
        <div style="font-size:13px;line-height:1.9;color:#4A2C5A">
          <div style="margin:8px 0;padding:10px;background:#fff;border-radius:12px">
            <b style="color:#FF6FA5">1. 本人消费积分</b><br>
            会员本人每消费 <b>1元</b>，获得 <b>1积分</b>
          </div>
          <div style="margin:8px 0;padding:10px;background:#fff;border-radius:12px">
            <b style="color:#A78BFA">2. 介绍朋友消费积分</b><br>
            被介绍的朋友消费：朋友本人得 <b>1分/元</b><br>
            介绍人得 <b>0.5分/元</b>（介绍有奖）
          </div>
          <div style="margin:8px 0;padding:10px;background:#fff;border-radius:12px">
            <b style="color:#059669">3. 积分兑换核销</b><br>
            积分可在「兑换」页面核销对应奖品，扣除相应积分。
          </div>
        </div>
      </div>` : ''}
  </div>`;
}
function addMember(){
  const name = $('#m_name').value.trim();
  const phone = $('#m_phone').value.trim();
  const ref = $('#m_ref').value;
  if(!name){ toast('请填写姓名'); return; }
  DB.members.push({id:uid(),name,phone,points:0,referrerId:ref||null,createdAt:Date.now()});
  save(); memberTab='list'; render(); toast('✅ 会员已添加');
}
function delMember(id){
  if(confirm('确认删除该会员？')){
    DB.members = DB.members.filter(m=>m.id!==id);
    save(); render(); toast('已删除');
  }
}
function adjustPoints(id){
  const m = DB.members.find(x=>x.id===id);
  if(!m) return;
  $('#modalBox').innerHTML = `
    <div class="modal-head"><h3>🔧 调整积分 · ${esc(m.name)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="card" style="background:#FFF8E1;margin-bottom:12px">当前积分：<b style="font-size:20px;color:var(--pink)">${m.points}</b></div>
    <div class="field"><label>调整（正数增加，负数扣除）</label><input id="adj_v" type="number" placeholder="如 50 或 -20"></div>
    <div class="field"><label>原因（可选）</label><input id="adj_r" placeholder="如 手动赠送/兑换扣减"></div>
    <div class="grid2"><button class="btn btn-ghost" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="doAdjust('${id}')">确认</button></div>`;
  $('#modalMask').classList.add('show');
}
function doAdjust(id){
  const m = DB.members.find(x=>x.id===id);
  const v = parseFloat($('#adj_v').value);
  if(isNaN(v)){ toast('请输入数字'); return; }
  m.points = Math.round((m.points+v)*10)/10;
  if(m.points<0) m.points=0;
  save(); closeModal(); render(); toast('✅ 已调整');
}

/* === 6.5 积分记录 === */
function renderPoints(){
  const totalPts = DB.members.reduce((a,b)=>a+b.points,0);
  return `
  <div class="page active">
    <div class="h-title">🎁 积分中心</div>
    <div class="stat s-purple" style="margin-bottom:12px"><div class="k">全场累计积分</div><div class="v">${Math.round(totalPts*10)/10}</div><div class="emoji">🎁</div></div>
    <div class="card">
      <div class="h-title" style="font-size:15px">🏆 积分排行</div>
      ${DB.members.length===0?'<div class="empty"><span class="emoji">🎁</span>暂无会员</div>':
        DB.members.slice().sort((a,b)=>b.points-a.points).map((m,i)=>`
        <div class="row">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:16px">${['🥇','🥈','🥉'][i]||'⭐'}</span>
            <div><div class="v" style="font-size:13px">${esc(m.name)}</div><div class="k" style="font-size:11px">${esc(m.phone||'')}</div></div>
          </div>
          <div class="big-num" style="color:var(--pink)">${m.points}</div>
        </div>`).join('')
      }
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px">📜 积分获取记录</div>
      ${DB.sales.filter(s=>s.pointsEarned>0).slice(-8).reverse().map(s=>`
        <div class="row">
          <div><div class="v" style="font-size:13px">${esc(s.memberName)} 消费 ${money(s.total)}</div><div class="k" style="font-size:11px">${fmtDate(s.time)}</div></div>
          <div style="text-align:right">
            <div class="pill" style="background:#E6FFF6;color:#059669">+${s.pointsEarned}</div>
            ${s.referrerBonus?`<div class="pill" style="background:#E0F2FE;color:#0284C7;margin-top:3px">介绍人+${s.referrerBonus}</div>`:''}
          </div>
        </div>`).join('') || '<div class="empty"><span class="emoji">📝</span>暂无记录</div>'}
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px">🎟️ 兑换记录</div>
      ${DB.redeems.slice(-6).reverse().map(r=>`
        <div class="row">
          <div><div class="v" style="font-size:13px">${esc(r.memberName)} · ${esc(r.itemName)}</div><div class="k" style="font-size:11px">${fmtDate(r.time)}</div></div>
          <div class="pill" style="background:#FFE0E0;color:#E63946">-${r.cost}分</div>
        </div>`).join('') || '<div class="empty"><span class="emoji">🎟️</span>暂无兑换</div>'}
    </div>
  </div>`;
}

/* === 6.6 兑换核销 === */
function renderRedeem(){
  return `
  <div class="page active">
    <div class="h-title">🎟️ 积分兑换核销</div>
    <div class="card">
      <label>选择会员</label>
      <select id="rd_member" onchange="renderRedeemMember()">
        <option value="">请选择会员</option>
        ${DB.members.map(m=>`<option value="${m.id}">${esc(m.name)} (${m.points}分)</option>`).join('')}
      </select>
      <div id="rd_info"></div>
    </div>
    <div class="card">
      <div class="h-title" style="font-size:15px;margin-bottom:8px">🎁 可兑换奖品</div>
      ${DB.redeemItems.map(it=>`
        <div class="row">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:24px">${it.emoji}</span>
            <div><div class="v" style="font-size:13px">${esc(it.name)}</div><div class="k" style="font-size:11px">需 ${it.cost} 积分</div></div>
          </div>
          <button class="btn btn-mint btn-sm" onclick="redeem('${it.id}')">兑换核销</button>
        </div>`).join('')}
    </div>
    <div class="card" style="background:#FFF8E1">
      <div style="font-size:12px;line-height:1.7;color:#7A5C8A">
        <b>核销流程：</b>选择会员 → 点击「兑换核销」→ 自动扣除对应积分 → 生成兑换记录。积分不足时无法兑换。
      </div>
    </div>
  </div>`;
}
function renderRedeemMember(){
  const id = $('#rd_member').value;
  const m = id ? DB.members.find(x=>x.id===id) : null;
  $('#rd_info').innerHTML = m ? `<div style="margin-top:8px;padding:10px;background:linear-gradient(135deg,#A78BFA,#FF6FA5);color:#fff;border-radius:14px"><div style="font-size:11px;opacity:.9">${esc(m.name)} 当前积分</div><div style="font-size:24px;font-weight:900">${m.points}</div></div>` : '';
}
function redeem(itemId){
  const mid = $('#rd_member').value;
  if(!mid){ toast('请先选择会员'); return; }
  const m = DB.members.find(x=>x.id===mid);
  const it = DB.redeemItems.find(x=>x.id===itemId);
  if(!m||!it) return;
  if(m.points < it.cost){ toast(`积分不足，需${it.cost}分`); return; }
  if(confirm(`确认为「${m.name}」核销「${it.name}」？\n扣除 ${it.cost} 积分`)){
    m.points = Math.round((m.points - it.cost)*10)/10;
    DB.redeems.push({id:uid(),memberId:mid,memberName:m.name,itemId,itemName:it.name,cost:it.cost,time:Date.now()});
    save(); render(); toast(`✅ 核销成功 · ${it.name}`);
  }
}

/* ---------- 7. 初始化 ---------- */
function afterRender(){
  // 收银页保持购物车
  if(curPage==='sale'){ const sel=$('#saleMember'); if(sel){ sel.value = saleMemberId; } }
  if(curPage==='redeem'){ renderRedeemMember(); }
  // 让 select 选项变化时同步到全局变量
  const sm = $('#saleMember');
  if(sm && curPage==='sale'){ sm.onchange = ()=>{ saleMemberId = sm.value; }; }
  // 总览页：异步查询真实存储配额
  if(curPage==='dashboard'){
    realStorageEstimate().then(info=>{
      const sub = $('#storageSub');
      if(sub && info){
        sub.textContent = `配额 ${info.quotaMB}MB`;
        const box = $('#storageInfo');
        if(box){
          box.innerHTML = `<div class="sum-line"><span>已用空间</span><b>${info.usageMB} MB</b></div><div class="sum-line"><span>浏览器配额</span><b>${info.quotaMB} MB</b></div><div class="sum-line"><span>预计还可录入</span><b>${estStorage().remainSkus} 款商品</b></div>`;
        }
      }else if(sub){
        sub.textContent = `${estStorage().usedMB}MB`;
      }
    });
  }
}

// PWA 注册
if('serviceWorker' in navigator){
  // 本地 file:// 无需 SW；通过 manifest + apple-touch-icon 已支持"添加到主屏幕"
}

load();
nav('dashboard');

// 防止双击缩放
document.addEventListener('dblclick', e=>e.preventDefault());
let lastTouch=0;
document.addEventListener('touchend', e=>{ const n=Date.now(); if(n-lastTouch<300){ e.preventDefault(); } lastTouch=n; }, {passive:false});
