const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD  || 'survey2024';
const SHEET_ID        = process.env.GOOGLE_SHEET_ID;
const CLIENT_EMAIL    = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY     = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Question option labels (Chinese) ───────────────────────
const OPTIONS = {
  S1:  ['有，几乎每次洗头后都用','有，每周用几次','偶尔用，视场合而定','很少或几乎从不使用'],
  Q1:  ['18–24岁','25–30岁','31–35岁','36–40岁','41–45岁','45岁以上'],
  Q2:  ['中国大陆','中国香港/澳门/台湾','美国/加拿大','欧洲','中东（沙特、UAE等）','俄罗斯/东欧','东南亚','其他'],
  Q3:  ['几乎每周','每月2–3次','每月1次','每季度1–2次','每年几次或更少','基本不出行'],
  Q4L: ['超短发（耳上）','短发（耳下至下巴）','中短发（下巴至肩膀）','中长发（肩膀至胸口）','长发（胸口以下）'],
  Q5LS:['每天高形象要求','办公室偶有会面','居家/自由职业','学生','以家庭为主','其他'],
  Q6HT:['天然直发','自然波浪纹','卷曲（大卷/中卷）','紧密小卷','发量少发丝细软','发量适中','发量多发丝粗硬','健康有光泽','干燥毛糙','受损（易断分叉）','头皮出油发根塌','染过色','做过卷烫','做过拉直/离子烫','未做过化学处理'],
  Q7PW:['自然顺直','轻微弯曲','毛糙蓬松','卷曲打结','头皮出油快','干燥粗糙'],
  Q8A: ['5分钟以内','5–10分钟','10–20分钟','20–30分钟','30分钟以上'],
  Q8B: ['完全可以接受','有点长但还能接受','太长了希望缩短'],
  Q8C: ['吹干太慢头发太厚','造型难达预期','工具操作麻烦','早上时间太紧','其他'],
  Q9A: ['几乎每天','每周2–3次','每周1次','有重要场合才做','很少觉得太麻烦'],
  Q9B: ['工具效果不好','操作太复杂','太花时间','容易烫伤发质','效果维持不住','没有明显难点'],
  Q10: ['是每3个月左右','是每6个月左右','偶尔不固定','从不'],
  Q10B:['发质健康无受损','轻微受损','中度受损','较严重受损'],
  Q10C:['完全不担心','有一点担心','比较担心','非常担心'],
  Q11: ['普通工作日','重要会议/客户见面','约会/重要社交','周末出行/聚会','出差/商务旅行','休闲旅行/度假','居家不出门'],
  Q12: { rows:['普通工作日','重要会议/商务','约会/重要社交','出差/商务旅行','休闲旅行/度假'], cols:['没困扰','轻微','较明显','非常困扰'] },
  Q13: ['没合适工具用酒店吹风机','工具太重太占行李','国外电压/插头不兼容','没时间整理','换地方水质/气候变化','直接放弃造型','没有特别困扰'],
  Q14: ['普通吹风机','高速吹风机','热风梳/热风刷','热风造型套装','Dyson Airwrap/Supersonic','卷发棒（手动）','自动卷发棒','直板夹/离子夹','负离子梳/电热梳','基本不用工具','其他'],
  QPUR:['日常快速打理省时省力','做出精致造型效果专业','保护发质减少损伤','出行携带轻便好用','一机多用减少工具数量'],
  QPREF1:['多功能但精简的套装','简单易用的热风梳','还没想好看具体产品再决定'],
  QPREF2:['直发梳','椭圆梳','两种都想要','不确定需要更多了解'],
  Q17: ['造型效果好持久','操作简单不需技巧','对头发损伤小','轻便适合携带','多功能一个顶多个','性价比高','品牌口碑和评价'],
  Q19: null, // scale 1-5, keep as number
  Q20: ['可换头设计','康达气流技术','创新梳齿设计','智能温度监控','等离子护发技术','全球通用电压','轻便紧凑'],
  Q21: ['不确定效果','担心换头操作麻烦','全球电压不重要','价格超预算','市面已有类似产品','品牌不熟悉','没有疑虑很感兴趣'],
  Q22: ['完全可以接受愿意购买','略高但效果好会考虑','偏高可能等打折','超出预算不会购买','需先看真实评价'],
  Q24: ['愿意请联系我','可能愿意视情况','暂时不需要'],
};

function decodeAnswer(qid, val) {
  if (val === undefined || val === null || val === '') return '';
  const opts = OPTIONS[qid];

  // Scale question — keep number
  if (opts === null) return String(val);

  // Open text
  if (!opts) return String(val);

  // Grid/matrix — val is object like {"0":2,"1":1}
  if (opts && opts.rows) {
    if (typeof val === 'object' && !Array.isArray(val)) {
      return opts.rows.map((row, i) => {
        const colIdx = val[i] !== undefined ? val[i] : val[String(i)];
        const colLabel = colIdx !== undefined ? (opts.cols[colIdx] || colIdx) : '—';
        return `${row}:${colLabel}`;
      }).join(' | ');
    }
    return JSON.stringify(val);
  }

  // Multi-select — val is array like [0,2,4]
  if (Array.isArray(val)) {
    return val.map(i => opts[i] !== undefined ? opts[i] : i).join('、');
  }

  // Rank — val is object like {"0":2,"1":1,"2":3}
  if (typeof val === 'object') {
    const entries = Object.entries(val).sort((a,b) => a[1]-b[1]);
    return entries.map(([itemIdx, rank]) => `${rank}.${opts[itemIdx]||itemIdx}`).join(' | ');
  }

  // Single select — val is number index
  const idx = Number(val);
  return opts[idx] !== undefined ? opts[idx] : String(val);
}

// ── Google Sheets JWT Auth ──────────────────────────────────
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function getAccessToken() {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  };
  const header  = base64url(Buffer.from(JSON.stringify({ alg:'RS256', typ:'JWT' })));
  const payload = base64url(Buffer.from(JSON.stringify(claim)));
  const signing = `${header}.${payload}`;
  const crypto  = require('crypto');
  const sign    = crypto.createSign('RSA-SHA256');
  sign.update(signing);
  const sig = base64url(sign.sign(PRIVATE_KEY));
  const jwt = `${signing}.${sig}`;

  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req  = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length': body.length }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data).access_token); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function sheetsAppend(token, values) {
  const body = JSON.stringify({ values });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${SHEET_ID}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      method: 'POST',
      headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function sheetsGet(token, range) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${SHEET_ID}/values/${range}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

// Column headers (human-readable)
const COL_HEADERS = [
  'ID','提交时间','语言',
  '筛选：有使用造型工具习惯',
  '年龄段','居住地','出行频率','头发长度','日常生活状态','发质描述',
  '洗后头发状态','打理时间','时间是否过长','主要难点（时间长）',
  '造型频率','在家造型难点','烫发/拉直频率','发质受损程度','对伤发的担心程度',
  '最在意头发的场景','各场景困扰程度','出行头发困扰',
  '日常使用工具','购买目的','倾向套装还是热风梳','热风梳类型偏好','最看重的购买因素','工具改进建议',
  '产品兴趣评分（1-5）','产品特点吸引力排序','产品疑虑','价格态度',
  '给产品团队的话','后续参与意愿','联系方式'
];

const Q_ORDER = [
  'S1','Q1','Q2','Q3','Q4L','Q5LS','Q6HT',
  'Q7PW','Q8A','Q8B','Q8C','Q9A','Q9B','Q10','Q10B','Q10C',
  'Q11','Q12','Q13','Q14','QPUR','QPREF1','QPREF2','Q17','Q18',
  'Q19','Q20','Q21','Q22','Q23','Q24','Q25'
];

async function appendToSheet(record) {
  const token = await getAccessToken();

  // Check headers
  const check = await sheetsGet(token, 'A1:C1');
  if (!check.values || !check.values.length) {
    await sheetsAppend(token, [COL_HEADERS]);
  }

  const row = [
    record.id,
    new Date(record.submittedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    record.lang,
    ...Q_ORDER.map(qid => decodeAnswer(qid, record.answers[qid]))
  ];

  await sheetsAppend(token, [row]);
  console.log(`[Sheet] Row appended — ${record.id}`);
}

// ── Local backup ────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'responses.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
function readLocal() { try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); } catch { return []; } }
function writeLocal(data) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2)); } catch(e) { console.error('Local write:',e.message); } }

// ── Routes ──────────────────────────────────────────────────
app.get('/',       (_,res) => res.redirect('/survey'));
app.get('/survey', (_,res) => res.sendFile(path.join(__dirname,'public','survey.html')));

app.post('/api/submit', async (req, res) => {
  try {
    const { lang, answers } = req.body;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error:'Invalid payload' });
    const record = { id: uuidv4(), lang: lang||'unknown', submittedAt: new Date().toISOString(), answers };
    const all = readLocal(); all.push(record); writeLocal(all);
    appendToSheet(record).catch(err => console.error('[Sheet Error]', err.message));
    res.json({ success: true, id: record.id });
  } catch(err) {
    console.error('Submit error:', err);
    res.status(500).json({ error:'Server error' });
  }
});

app.get('/api/stats', (req,res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error:'Unauthorized' });
  const all = readLocal();
  const byLang = all.reduce((acc,r)=>{ acc[r.lang]=(acc[r.lang]||0)+1; return acc; },{});
  const scores = all.map(r=>r.answers['Q19']).filter(Boolean);
  const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(2) : null;
  const priceDist  = all.map(r=>r.answers['Q22']).filter(v=>v!==undefined).reduce((acc,v)=>{ acc[v]=(acc[v]||0)+1; return acc; },{});
  const followDist = all.map(r=>r.answers['Q24']).filter(v=>v!==undefined).reduce((acc,v)=>{ acc[v]=(acc[v]||0)+1; return acc; },{});
  res.json({ total:all.length, byLanguage:byLang, avgInterestScore:avg, priceAttitude:priceDist, followUpWillingness:followDist,
    latest:all.slice(-5).map(r=>({ id:r.id, lang:r.lang, time:r.submittedAt })) });
});

app.get('/api/responses', (req,res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error:'Unauthorized' });
  res.json({ total: readLocal().length, data: readLocal() });
});

app.get('/api/export.csv', (req,res) => {
  if (req.query.password !== ADMIN_PASSWORD) return res.status(401).json({ error:'Unauthorized' });
  const all = readLocal();
  if (!all.length) return res.status(404).send('No data yet');
  const header = ['id','lang','submittedAt',...Q_ORDER];
  const rows = all.map(r=>[r.id,r.lang,r.submittedAt,...Q_ORDER.map(k=>{
    const v=r.answers[k]; if(v==null) return '';
    if(typeof v==='object') return JSON.stringify(v).replace(/,/g,'|');
    return String(v).replace(/,/g,'，');
  })].map(c=>`"${String(c).replace(/"/g,'""')}"`).join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="survey_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF'+[header.join(','),...rows].join('\n'));
});

app.get('/admin', (req,res) => {
  if (req.query.password !== ADMIN_PASSWORD) {
    return res.send(`<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f4f2ee;margin:0}
form{background:#fff;padding:32px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
h2{margin-bottom:20px;color:#1a1a2e}input{padding:10px 14px;border:1.5px solid #d4cfc7;border-radius:8px;font-size:14px;width:200px;outline:none}
input:focus{border-color:#7a9e87}button{display:block;width:100%;margin-top:12px;padding:10px;background:#1a1a2e;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}
</style></head><body><form method="GET" action="/admin"><h2>🔒 管理后台</h2>
<input type="password" name="password" placeholder="输入管理密码" autofocus><button type="submit">进入</button></form></body></html>`);
  }
  const pwd = req.query.password;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>问卷后台</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'PingFang SC',sans-serif;background:#f4f2ee;color:#1a1a2e}
.hdr{background:#1a1a2e;color:#fff;padding:18px 28px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
.hdr h1{font-size:16px}.acts{display:flex;gap:8px;flex-wrap:wrap}
.btn{padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;border:none;text-decoration:none;display:inline-flex;align-items:center}
.g{background:#0f9d58;color:#fff}.e{background:#7a9e87;color:#fff}.r{background:rgba(255,255,255,.12);color:#fff}
.main{padding:24px 28px}
.notice{background:#e2efda;border-radius:10px;padding:14px 18px;margin-bottom:20px;font-size:13px;color:#2d6b4a;line-height:1.6}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.sc{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.sc .v{font-size:28px;font-weight:700}.sc .l{font-size:11px;color:#888;margin-top:5px}.sc .s{font-size:12px;color:#555;margin-top:8px;line-height:1.8}
.tw{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.06);overflow:hidden}
.th{padding:12px 18px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
.th h2{font-size:14px;font-weight:600}.th span{font-size:12px;color:#888}
table{width:100%;border-collapse:collapse}th{background:#f9f8f6;font-size:11px;font-weight:600;color:#666;padding:9px 14px;text-align:left;border-bottom:1px solid #eee}
td{font-size:12px;padding:9px 14px;border-bottom:1px solid #f0ede8}tr:last-child td{border-bottom:none}tr:hover td{background:#fafaf8}
.lt{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:500}
.zh{background:#e8f4fb;color:#1a6fa8}.en{background:#e2efda;color:#2d6b4a}.ar{background:#fdf0e8;color:#8a4c1a}.ru{background:#ead1dc;color:#5c2b6b}
.pv{max-width:260px;font-size:11px;color:#666;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tm{color:#aaa;font-size:11px;white-space:nowrap}.empty{padding:40px;text-align:center;color:#aaa;font-size:13px}
</style></head><body>
<div class="hdr"><h1>📊 美发工具调研 · 管理后台</h1>
<div class="acts">
  <button class="btn r" onclick="location.reload()">刷新</button>
  <a class="btn g" href="${sheetUrl}" target="_blank">📊 Google 表格（主数据）</a>
  <button class="btn e" onclick="window.open('/api/export.csv?password=${pwd}')">导出 CSV</button>
</div></div>
<div class="main">
<div class="notice">✅ <strong>完整数据在 Google 表格中</strong>（已转换为可读文字），点击上方绿色按钮查看。下方为服务器本地备份。</div>
<div class="stats">
  <div class="sc"><div class="v" id="s0">—</div><div class="l">回复总数</div></div>
  <div class="sc"><div class="v" id="s1">—</div><div class="l">平均兴趣评分/5</div></div>
  <div class="sc"><div class="s" id="s2">加载中…</div><div class="l">按语言分布</div></div>
  <div class="sc"><div class="s" id="s3">加载中…</div><div class="l">后续参与意愿</div></div>
</div>
<div class="tw">
  <div class="th"><h2>最近回复</h2><span id="tc">—</span></div>
  <div id="ta"></div>
</div></div>
<script>
const pwd='${pwd}';
const FL={0:'✅愿意',1:'🤔可能',2:'❌暂不'};
const PL={0:'✅接受',1:'略高',2:'等折扣',3:'超预算',4:'看评价'};
async function load(){
  try{
    const d=(await(await fetch('/api/stats?password='+pwd)).json());
    document.getElementById('s0').textContent=d.total;
    document.getElementById('s1').textContent=d.avgInterestScore||'—';
    const lm={zh:'🇨🇳中文',en:'🇺🇸英文',ar:'🇸🇦阿拉伯',ru:'🇷🇺俄文'};
    document.getElementById('s2').innerHTML=Object.entries(d.byLanguage).map(([l,n])=>\`\${lm[l]||l}：<strong>\${n}</strong>\`).join('<br>')||'暂无';
    document.getElementById('s3').innerHTML=Object.entries(d.followUpWillingness).map(([k,v])=>\`\${FL[k]||k}：<strong>\${v}</strong>\`).join('<br>')||'暂无';
  }catch(e){}
  try{
    const d2=(await(await fetch('/api/responses?password='+pwd)).json());
    document.getElementById('tc').textContent=d2.total+' 条';
    if(!d2.data||!d2.data.length){document.getElementById('ta').innerHTML='<div class="empty">暂无本地数据，请查看 Google 表格</div>';return;}
    const rows=[...d2.data].reverse().map(r=>{
      const t=new Date(r.submittedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      const q19=r.answers.Q19?\`⭐\${r.answers.Q19}/5\`:'';
      const q22=r.answers.Q22!==undefined?PL[r.answers.Q22]:'';
      const q25=r.answers.Q25?\`📞\${r.answers.Q25}\`:'';
      const q23=r.answers.Q23?\`💬\${r.answers.Q23}\`:'';
      const pv=[q19,q22,q25,q23].filter(Boolean).join(' | ');
      return \`<tr><td class="tm">\${t}</td><td><span class="lt \${r.lang}">\${r.lang.toUpperCase()}</span></td><td><div class="pv">\${pv||'—'}</div></td><td style="font-size:10px;color:#bbb">\${r.id.slice(0,8)}</td></tr>\`;
    }).join('');
    document.getElementById('ta').innerHTML=\`<table><thead><tr><th>时间</th><th>语言</th><th>摘要</th><th>ID</th></tr></thead><tbody>\${rows}</tbody></table>\`;
  }catch(e){}
}
load();
</script></body></html>`);
});

app.get('/health', (_,res) => res.json({ status:'ok', sheet:SHEET_ID?'configured':'missing', time:new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log(`Client Email: ${CLIENT_EMAIL}`);
});
