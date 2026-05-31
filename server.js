const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'survey2024';
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'responses.json');

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Init data directory & file ─────────────────────────────
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

function readResponses() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function writeResponses(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Root redirect to survey ─────────────────────────────────
app.get('/', (req, res) => {
  res.redirect('/survey');
});

// ── Serve survey.html at /survey ───────────────────────────
app.get('/survey', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'survey.html'));
});

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit', (req, res) => {
  try {
    const { lang, answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const record = {
      id: uuidv4(),
      lang: lang || 'unknown',
      submittedAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      answers,
    };
    const all = readResponses();
    all.push(record);
    writeResponses(all);
    console.log(`[${record.submittedAt}] New response — lang:${record.lang} id:${record.id}`);
    res.json({ success: true, id: record.id });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/responses ─────────────────────────────────────
app.get('/api/responses', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const all = readResponses();
  res.json({ total: all.length, data: all });
});

// ── GET /api/export.csv ────────────────────────────────────
app.get('/api/export.csv', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const all = readResponses();
  if (all.length === 0) return res.status(404).send('No data yet');
  const allKeys = new Set();
  all.forEach(r => Object.keys(r.answers).forEach(k => allKeys.add(k)));
  const keys = [...allKeys].sort();
  const header = ['id', 'lang', 'submittedAt', 'ip', ...keys];
  const rows = all.map(r => [
    r.id, r.lang, r.submittedAt, r.ip,
    ...keys.map(k => {
      const v = r.answers[k];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v).replace(/,/g, '|');
      return String(v).replace(/,/g, '，');
    })
  ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const filename = `survey_${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
});

// ── GET /api/stats ─────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  const all = readResponses();
  const byLang = all.reduce((acc, r) => { acc[r.lang] = (acc[r.lang]||0)+1; return acc; }, {});
  const scores = all.map(r => r.answers['Q19']).filter(Boolean);
  const avgScore = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2) : null;
  const priceAns = all.map(r => r.answers['Q22']).filter(v => v !== undefined);
  const priceDist = priceAns.reduce((acc,v)=>{ acc[v]=(acc[v]||0)+1; return acc; },{});
  const followAns = all.map(r => r.answers['Q24']).filter(v => v !== undefined);
  const followDist = followAns.reduce((acc,v)=>{ acc[v]=(acc[v]||0)+1; return acc; },{});
  res.json({ total: all.length, byLanguage: byLang, avgInterestScore: avgScore,
    priceAttitude: priceDist, followUpWillingness: followDist,
    latest: all.slice(-5).map(r=>({ id:r.id, lang:r.lang, time:r.submittedAt })) });
});

// ── Admin dashboard ────────────────────────────────────────
app.get('/admin', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD) {
    return res.send(`<html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f4f2ee;margin:0}
      form{background:#fff;padding:32px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
      h2{margin-bottom:20px;color:#1a1a2e;font-size:18px}
      input{padding:10px 14px;border:1.5px solid #d4cfc7;border-radius:8px;font-size:14px;width:200px;outline:none}
      input:focus{border-color:#7a9e87}
      button{display:block;width:100%;margin-top:12px;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}
      </style></head><body>
      <form method="GET" action="/admin">
        <h2>🔒 管理后台</h2>
        <input type="password" name="password" placeholder="输入管理密码" autofocus>
        <button type="submit">进入</button>
      </form></body></html>`);
  }
  const pwd = req.query.password;
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>问卷后台</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'PingFang SC',sans-serif;background:#f4f2ee;color:#1a1a2e}
.header{background:#1a1a2e;color:#fff;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:18px}.actions{display:flex;gap:10px}
.btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none}
.btn-export{background:#7a9e87;color:#fff}.btn-refresh{background:rgba(255,255,255,.12);color:#fff}
.main{padding:24px 32px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px}
.stat-card{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.stat-card .val{font-size:32px;font-weight:700}.stat-card .lbl{font-size:12px;color:#888;margin-top:6px}
.stat-card .sub{margin-top:10px;font-size:12px;color:#555;line-height:1.8}
.table-wrap{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.06);overflow:hidden}
.table-head{padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
.table-head h2{font-size:15px;font-weight:600}.table-head span{font-size:12px;color:#888}
table{width:100%;border-collapse:collapse}
th{background:#f9f8f6;font-size:12px;font-weight:600;color:#666;padding:10px 16px;text-align:left;border-bottom:1px solid #eee}
td{font-size:13px;padding:10px 16px;border-bottom:1px solid #f0ede8}
tr:last-child td{border-bottom:none}tr:hover td{background:#fafaf8}
.lang-tag{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:500}
.lang-zh{background:#e8f4fb;color:#1a6fa8}.lang-en{background:#e2efda;color:#2d6b4a}
.lang-ar{background:#fdf0e8;color:#8a4c1a}.lang-ru{background:#ead1dc;color:#5c2b6b}
.preview{max-width:320px;font-size:11.5px;color:#666;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.time{color:#aaa;font-size:12px}.empty{padding:48px;text-align:center;color:#aaa}
</style></head><body>
<div class="header">
  <div><h1>📊 美发工具调研 · 管理后台</h1></div>
  <div class="actions">
    <button class="btn btn-refresh" onclick="location.reload()">刷新</button>
    <button class="btn btn-export" onclick="window.open('/api/export.csv?password=${pwd}')">导出 CSV</button>
  </div>
</div>
<div class="main">
  <div class="stats">
    <div class="stat-card"><div class="val" id="s-total">—</div><div class="lbl">总回复数</div></div>
    <div class="stat-card"><div class="val" id="s-score">—</div><div class="lbl">平均兴趣评分 / 5</div></div>
    <div class="stat-card"><div class="sub" id="s-lang">加载中…</div><div class="lbl">按语言分布</div></div>
    <div class="stat-card"><div class="sub" id="s-follow">加载中…</div><div class="lbl">后续参与意愿</div></div>
  </div>
  <div class="table-wrap">
    <div class="table-head"><h2>全部回复</h2><span id="t-count">—</span></div>
    <div id="t-area"></div>
  </div>
</div>
<script>
const pwd='${pwd}';
const FL={0:'✅ 愿意',1:'🤔 可能',2:'❌ 暂不'};
const PL={0:'✅接受',1:'略高',2:'等折扣',3:'超预算',4:'看评价'};
async function loadStats(){
  const r=await fetch('/api/stats?password='+pwd);
  const d=await r.json();
  document.getElementById('s-total').textContent=d.total;
  document.getElementById('s-score').textContent=d.avgInterestScore||'—';
  const lm={zh:'🇨🇳 中文',en:'🇺🇸 英文',ar:'🇸🇦 阿拉伯',ru:'🇷🇺 俄文'};
  document.getElementById('s-lang').innerHTML=Object.entries(d.byLanguage).map(([l,n])=>\`\${lm[l]||l}：<strong>\${n}</strong>\`).join('<br>')||'暂无';
  document.getElementById('s-follow').innerHTML=Object.entries(d.followUpWillingness).map(([k,v])=>\`\${FL[k]||k}：<strong>\${v}</strong>\`).join('<br>')||'暂无';
}
async function loadTable(){
  const r=await fetch('/api/responses?password='+pwd);
  const d=await r.json();
  document.getElementById('t-count').textContent=d.total+' 条回复';
  if(!d.data||d.data.length===0){document.getElementById('t-area').innerHTML='<div class="empty">暂无回复数据</div>';return;}
  const rows=[...d.data].reverse().map(r=>{
    const time=new Date(r.submittedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    const q19=r.answers.Q19?\`⭐ \${r.answers.Q19}/5\`:'';
    const q22=r.answers.Q22!==undefined?PL[r.answers.Q22]:'';
    const q25=r.answers.Q25?\`📞 \${r.answers.Q25}\`:'';
    const q23=r.answers.Q23?\`💬 \${r.answers.Q23}\`:'';
    const preview=[q19,q22,q25,q23].filter(Boolean).join('  |  ');
    return \`<tr><td class="time">\${time}</td><td><span class="lang-tag lang-\${r.lang}">\${r.lang.toUpperCase()}</span></td><td><div class="preview">\${preview||'—'}</div></td><td style="font-size:11px;color:#bbb">\${r.id.slice(0,8)}</td></tr>\`;
  }).join('');
  document.getElementById('t-area').innerHTML=\`<table><thead><tr><th>时间</th><th>语言</th><th>摘要</th><th>ID</th></tr></thead><tbody>\${rows}</tbody></table>\`;
}
loadStats();loadTable();
</script></body></html>`);
});

// ── Health check ───────────────────────────────────────────
app.get('/health', (_,res)=>res.json({status:'ok',time:new Date().toISOString()}));

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, ()=>{
  console.log(`Server running on port ${PORT}`);
  console.log(`Survey: http://localhost:${PORT}/survey`);
  console.log(`Admin:  http://localhost:${PORT}/admin?password=${ADMIN_PASSWORD}`);
});
