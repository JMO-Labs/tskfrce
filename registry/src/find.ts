import { BOX_ID_RE } from './auth'
import { isPrivateV4 } from './cf'
import type { Env } from './index'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (inner: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Find your t@sk4ce box</title>` +
      `<style>body{font:18px system-ui,sans-serif;max-width:32em;margin:2em auto;padding:0 1em}` +
      `.network{margin:1em 0;padding:1em;border:1px solid #ccc;border-radius:4px}` +
      `canvas{border:1px solid #000;display:block;margin:0.5em 0}</style>` +
      `</head><body><h1>Find your box</h1>${inner}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  )

const FORM =
  '<form method="get" action="/find"><p><label>Type the 6-character code from your box sticker<br>' +
  '<input name="id" maxlength="6" autocomplete="off" autocapitalize="none" required></label></p>' +
  '<button>Find my box</button></form>'
const ASK = FORM
const OFFLINE_HELP =
  '<p>No box with that code was found on this network. Try:</p>' +
  '<ul><li>Check the network cable connection</li><li>Plug in the power cable</li><li>Or use the Wi-Fi setup code on your box sticker</li></ul>' +
  '<p>Try again:</p>' + FORM
const MISS =
  '<p>No box with that code was found on this network. Make sure your phone is on your home Wi-Fi.</p>' + FORM

// QR code encoder (MIT licensed)
const QR_CODE_JS = `
function QRCode(t,e){this.typeNumber=t||0;this.errorCorrectLevel=e||"M";this.modules=null;this.moduleCount=0;this.dataCache=null}
QRCode.prototype.addData=function(t){this.dataCache=null;this.modules=null;this.dataList=[new QR8bitByte(t)]};
QRCode.prototype.render=function(t){t=t||'';var e=this.modules,n=this.moduleCount;if(!e)return'';for(var o=0;o<n;o++)for(var r=0;r<n;r++){var i=e[o][r];t+='<td style="width:20px;height:20px;background:'+(i?'#000':'#fff')+'"></td>'}return'<table>'+t+'</table>'};
QRCode.prototype.make=function(){if(-1==this.typeNumber){for(var t=1;t<=40;t++){var e=QR.rs_blocks(t,this.errorCorrectLevel);if(QRUtil.getLengthInBits(this.dataList)<=QRMath.getBCHDigits(e[0].totalCount*8))break}this.typeNumber=t}for(var e=QR.rs_blocks(this.typeNumber,this.errorCorrectLevel),n=new QRBitBuffer,o=0;o<this.dataList.length;o++)this.dataList[o].writeTo(n);for(var n=new QRBitBuffer,r=0;r<e.length;r++){for(var i=e[r],s=0;s<i.dataCount;s++)n.put(this.dataList[s].getData(8*(e[r].dataCount/i.dataCount)),8)}this.dataCache=n.getBuffer();var a=this.moduleCount=4*this.typeNumber+17;this.modules=new Array(a),o=0;o<a;o++)for(this.modules[o]=new Array(a),r=0;r<a;r++)this.modules[o][r]=null;this.setupPositionProbePattern(0,0);this.setupPositionProbePattern(a-7,0);this.setupPositionProbePattern(0,a-7);this.setupPositionAdjustPattern();this.setupTimingPattern();this.setupTypeInfo(!1,0);this.dataCache.length>0&&this.mapData(this.dataCache,0);for(var u=[],l=0;l<a;l++)u.push(new Array(a));for(o=0;o<a;o++)for(r=0;r<a;r++)u[o][r]=this.modules[o][r];this.modules=u};
QRCode.prototype.setupPositionProbePattern=function(t,e){for(var n=-1;n<=7;n++)if(t+n>=-1&&t+n<this.moduleCount){for(var o=-1;o<=7;o++)e+o>=-1&&e+o<this.moduleCount&&(this.modules[e+o][t+n]=(o>=0&&o<=6&&(0==n||n==6)|n>=0&&n<=6&&(0==o||o==6)|n>=2&&n<=4&&o>=2&&o<=4))}};
QRCode.prototype.mapData=function(t,e){for(var n=-1,o=this.moduleCount-1,r=7,i=0,s=this.moduleCount-1;s>0&&s-=2){for(6==s&&s--;s<this.moduleCount&&s>=0;){for(var a=0;a<2;a++){var u=o+a;if(this.modules[u][s]==null){var l=!1;i<t.length&&(l=(t[Math.floor(i/8)]>>>7-i%8&1)==1);this.modules[u][s]=l;i++}}o+=n;(o<0||this.moduleCount<=o)&&(o-=n,n=-n)}}};
QRCode.prototype.setupTimingPattern=function(){for(var t=8;t<this.moduleCount-8;t++)this.modules[t][6]==null&&(this.modules[t][6]=0==t%2),this.modules[6][t]==null&&(this.modules[6][t]=0==t%2)};
QRCode.prototype.setupTypeInfo=function(t,e){for(var n=[],o=0;o<15;o++)n.push(o);for(var o=0;o<n.length;o++){var r=n[o],i=QRUtil.getBCHDigits(r<<10)/7;n[o]^=i<<3|r}for(var s=n[0]^QRUtil.getBCHDigits(this.errorCorrectLevel==null?"L":0),a=0;a<15;a++){var u=!t&&((s>>>a&1)==1);u&&(this.modules[a<6?a:a+1][8]=!u),u&&(this.modules[8][14-a]=!u)}};
QRCode.prototype.setupPositionAdjustPattern=function(){for(var t=QR.PATTERN_POSITION_TABLE[this.typeNumber-1],e=0;e<t.length;e++)for(var n=0;n<t.length;n++){var o=t[e],r=t[n];null==this.modules[r][o]&&this.setupPositionProbePattern(o,r)}};
function QR8bitByte(t){this.mode=QR.MODE_8BIT_BYTE;this.data=t;this.parsedData=[];for(var e=0;e<t.length;e++){var n=t.charCodeAt(e);this.parsedData.push(n)}}
QR8bitByte.prototype.getLength=function(){return this.parsedData.length};
QR8bitByte.prototype.writeTo=function(t){for(var e=0;e<this.parsedData.length;e++)t.put(this.parsedData[e],8)};
function QRBitBuffer(){this.buffer=new Array,this.length=0}
QRBitBuffer.prototype.put=function(t,e){for(var n=0;n<e;n++)this.push(1==(t>>>e-n-1&1))};
QRBitBuffer.prototype.getLengthInBits=function(){return this.length};
QRBitBuffer.prototype.push=function(t){this.buffer[Math.floor(this.length/8)]=this.buffer[Math.floor(this.length/8)]||0,1==t&&(this.buffer[Math.floor(this.length/8)]|=128>>this.length%8),this.length++};
QRBitBuffer.prototype.getBuffer=function(){return this.buffer};
var QR={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8,PATTERN_POSITION_TABLE:[[],
[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,82,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],
rs_blocks:function(t,e){var n=QR.rs_blocks;t=n[e][t-1];return"number"==typeof t&&(t=[{dataCount:t,totalCount:t}]),t}};
QR.rs_blocks={L:[[1,26],[1,44],[1,70],[1,100],[1,134],[2,86],[2,98],[2,121],[2,2],[2,17],[2,34],[2,51],[2,108],[3,43],[3,59],[3,3,36],[3,36],[3,24,42],[4,20,61],[4,18,84],[4,16,4,104],[5,19,5,130],[5,19,9,98],[5,27,15,89],[5,13,3,29,34],[5,30],[2,50],[2,104],[2,84],[4,93],[1,80],[6,30],[6,58],[6,86],[6,23,8,113],[7,7,59],[7,59,37],[8,37,8,108],[8,8,113],[9,16,78],[9,43],[10,27],[10,29],[10,44],[10,44],[10,7,78],[10,22,10,86],[10,28,10,110],[10,26,10,114],[10,32,4,122],[10,30,4,118],[10,28,10,126],[10,26,13,116]],M:[[1,44],[1,70],[1,100],[1,134],[1,180],[2,108],[2,43,17],[2,43,34],[2,90],[2,30,61],[2,30,15,61],[3,30],[3,4,50],[3,3,36],[3,30,34],[4,4,80],[4,1,6,4,23],[4,8,37],[5,10,45],[5,5,10,50],[5,7,54],[5,13,87],[6,3,11,41],[6,28],[6,12,28],[7,4,20],[7,11,63],[7,11,18,26],[7,12,28,34],[8,8,23],[9,10,35],[9,14,34],[9,16,33],[9,4,10,50],[9,6,14,48],[9,30,12],[9,22,15],[9,12,32],[9,11,14,22],[9,29],[9,13,48],[10,40],[10,18,64],[10,16,14,52],[10,30,12],[10,22,13,74]],H:[[1,104],[1,176],[1,272],[2,100,4],[2,60,5,28],[4,108],[4,69,43],[4,69,22,7],[6,115],[6,87,40],[8,87,8,85],[8,23,8,111],[8,12,4,15,11],[11,12,3,4,26],[11,6,7,6,34],[11,17,4,9,10],[12,11,14],[12,29],[12,44],[13,39],[13,41],[13,18,4,18],[14,18,2,4,26],[15,4,14],[15,5,10],[15,7,12],[15,13],[15,14],[15,12],[15,6,29],[15,12,13]],Q:[[1,77],[1,122],[1,182],[1,255],[2,72,4],[2,80,20],[4,101],[4,144],[5,106],[5,122,56],[7,122],[7,152],[8,72,20,4],[8,72,4,8],[8,70,37],[9,80],[9,152],[10,106],[10,134],[10,150],[10,64,46],[10,88,10,64],[11,36,19,6],[11,30,38],[11,4,20,61],[11,36,19,12],[11,36,19,12],[11,64,46],[11,72],[11,88,10,64],[11,24,26],[11,44],[12,54]],}};
var QRMath={glog:new Array(256),exp:new Array(256),EXP_TABLE:new Array(256),MASK_FUNC:[function(t,e){return t+e&1},function(t,e){return t&1},function(t,e){return e%3==0},function(t,e){return(t+e)%3==0},function(t,e){return(Math.floor(t/2)+Math.floor(e/3))%2==0},function(t,e){return t*e%2+t*e%3==0},function(t,e){return(t*e%2+t*e%3)%2==0},function(t,e){return(t+e+t*e%3)%2==0}]};
QRMath.exp[0]=1;for(var i=1;i<256;i++){QRMath.exp[i]=QRMath.exp[i-1]*2;i<256&&QRMath.exp[i]>255&&(QRMath.exp[i]^=285)}for(i=0;i<255;i++)QRMath.glog[QRMath.exp[i]]=i;
var QRUtil={PATTERN_INDICATOR_CONSTANT:21522,BASE_TABLE:{},getBCHDigits:function(t){for(var e=0;t!=0;)e++,t>>>=1;return e},getBCHTypeInfo:function(t){for(var e=t<<10;QRUtil.getBCHDigits(e)-QRUtil.getBCHDigits(QRUtil.PATTERN_INDICATOR_CONSTANT)>=0;)e^=QRUtil.PATTERN_INDICATOR_CONSTANT<<QRUtil.getBCHDigits(e)-QRUtil.getBCHDigits(QRUtil.PATTERN_INDICATOR_CONSTANT);return(t<<10|e)^21522}};
function QRImage(t){this.qr=t;this.canvas=document.createElement('canvas')}
QRImage.prototype.draw=function(t){var e=this.qr.modules,n=e.length,o=Math.max(1,Math.floor(t/n)),r=this.canvas;r.width=r.height=n*o;var i=r.getContext('2d');i.fillStyle='white';i.fillRect(0,0,r.width,r.height);i.fillStyle='black';for(var s=0;s<n;s++)for(var a=0;a<n;a++)e[s][a]&&i.fillRect(a*o,s*o,o,o)};
QRImage.prototype.getModeFromVmode=function(t){return{Ality:1,Numb:2,"Byte":4,Kanji:8}[t]};
`

/** First 4 hextets (/64) of an IPv6 address, expanded; null if malformed. */
export function v6prefix(ip: string): string | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || (ip.match(/::/g) ?? []).length > 1) return null
  const [h, t] = ip.split('::')
  const head = h ? h.split(':') : [], tail = t ? t.split(':') : []
  const fill = ip.includes('::') ? 8 - head.length - tail.length : 0
  if (fill < 0 || (!ip.includes('::') && head.length !== 8)) return null
  const all = [...head, ...Array(fill).fill('0'), ...tail]
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null
  return all.slice(0, 4).map((x) => parseInt(x, 16)).join(':')
}

type Seen = {
  lanIp?: string
  publicIp4?: string
  publicIp6?: string
  seenAt4?: number
  seenAt6?: number
  networks?: Array<{ ip: string; label: string }>
  last_seen?: number
}

/** Box reports hourly; ignore a family not heard from in 2 reports. */
export const FIND_MAX_AGE_MS = 2 * 60 * 60 * 1000
export const FIND_OFFLINE_MS = 15 * 60 * 1000 // 15 minutes

function sameNetwork(seen: Seen, visitor: string, now: number): boolean {
  const fresh = (t?: number) => typeof t === 'number' && now - t <= FIND_MAX_AGE_MS
  const p4 = fresh(seen.seenAt4) ? seen.publicIp4 : '', p6 = fresh(seen.seenAt6) ? seen.publicIp6 : ''
  if (!visitor.includes(':')) return !!p4 && p4 === visitor
  const v = v6prefix(visitor)
  return !!v && !!p6 && v === v6prefix(p6)
}

function isOnline(seen: Seen, now: number): boolean {
  if (seen.networks && seen.last_seen) {
    return now - seen.last_seen <= FIND_OFFLINE_MS
  }
  const t4 = seen.seenAt4 ?? 0, t6 = seen.seenAt6 ?? 0
  const latest = Math.max(t4, t6)
  return latest > 0 && now - latest <= FIND_OFFLINE_MS
}

async function checkRateLimit(env: Env, visitorIp: string | null, now: number): Promise<boolean> {
  if (!visitorIp) return false
  const key = `ratelimit:find:${visitorIp}`
  const raw = await env.BOXES.get(key)
  let count = 0, startTime = now
  if (raw) {
    try {
      const data = JSON.parse(raw)
      count = data.count ?? 0
      startTime = data.startTime ?? now
    } catch { /* corrupt -> reset */ }
  }
  // Reset if more than 1 hour
  if (now - startTime > 3600000) {
    count = 0
    startTime = now
  }
  if (count >= 20) return false // Rate limited
  // Increment and store
  await env.BOXES.put(key, JSON.stringify({ count: count + 1, startTime }), { expirationTtl: 3600 })
  return true
}

function renderQRCode(id: string, networkIndex: number): string {
  const url = `https://${id}${networkIndex === 0 ? '' : `-${networkIndex + 1}`}.taskfrce.jmolabs.dev/`
  return `
    <canvas id="qr${networkIndex}"></canvas>
    <script>
      ${QR_CODE_JS}
      var qr=new QRCode(0,"L");qr.addData("${url}");qr.make();
      var img=new QRImage(qr);img.draw(200);
      document.getElementById("qr${networkIndex}").parentNode.replaceChild(img.canvas,document.getElementById("qr${networkIndex}"));
    </script>`
}

/** Reveals LAN IPs and redirects/QR codes, or setup help. Unknown and offline look identical. */
export async function findPage(id: string | null, visitorIp: string | null, env: Env, now: number = Date.now()): Promise<Response> {
  // Check rate limit first
  const allowed = await checkRateLimit(env, visitorIp, now)
  if (!allowed) return new Response(MISS, { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

  if (!id) return page(ASK)
  const code = id.trim().toLowerCase()
  if (!BOX_ID_RE.test(code)) return page(MISS)

  let seen: Seen | null = null
  try {
    const raw = await env.BOXES.get(`seen:${code}`)
    seen = raw ? JSON.parse(raw) : null
  } catch { /* corrupt entry -> not found */ }

  // Handle old format (single IP)
  if (seen?.lanIp && isPrivateV4(seen.lanIp) && visitorIp && sameNetwork(seen, visitorIp, now)) {
    const url = esc(`http://${seen.lanIp}:3000`)
    return page(
      `<p>Found your box. Open it here:</p><p><a href="${url}">${url}</a></p>` +
        `<p>Your router blocks the box's web address (DNS rebinding protection). The link above still works, ` +
        `or allow <code>taskfrce.jmolabs.dev</code> in your router's settings.</p>`,
    )
  }

  // Handle new format (multiple networks)
  if (seen?.networks && Array.isArray(seen.networks) && visitorIp && sameNetwork(seen, visitorIp, now) && isOnline(seen, now)) {
    if (seen.networks.length === 1) {
      // Single network: redirect
      const loc = `https://${code}.taskfrce.jmolabs.dev/`
      return new Response(null, { status: 302, headers: { Location: loc } })
    }
    // Multiple networks: show buttons and QR codes
    let inner = `<p>Found your box on multiple networks:</p>`
    for (let i = 0; i < seen.networks.length; i++) {
      const net = seen.networks[i]
      inner += `<div class="network"><p><strong>${esc(net.label)}</strong></p>${renderQRCode(code, i)}</div>`
    }
    return page(inner)
  }

  // Unknown or offline (look identical)
  return page(OFFLINE_HELP)
}
