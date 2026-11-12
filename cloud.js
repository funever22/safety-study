import {fresh} from './core.js';
export const LEGACY_KEY='songhak-safety-study-v1';
export const CLOUD_KEY=LEGACY_KEY+':cloud-v2';
export const TOKEN_KEY=CLOUD_KEY+':token';
export const META_KEY=CLOUD_KEY+':sync';
export const API_URL='https://nrrlygoknpuoemcqwitx.supabase.co/functions/v1/safety-study-sync';
export function mergeStates(remote,local){
 const r=remote||fresh(),l=local||fresh(),byAttempt=new Map(),pairs=new Set();
 // Existing server events win when two devices submit the same session question.
 for(const a of [...r.attempts,...l.attempts]){const pair=a.sessionId+'|'+a.questionId;if(!byAttempt.has(a.id)&&!pairs.has(pair)){byAttempt.set(a.id,a);pairs.add(pair);}}
 const attempts=[...byAttempt.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 const sessions=new Map();
 for(const s of [...r.sessions,...l.sessions]){const prev=sessions.get(s.id);if(!prev||s.finishedAt>prev.finishedAt)sessions.set(s.id,s);}
 let active=null;
 const candidates=[r.active,l.active].filter(s=>s&&!sessions.has(s.id));
 if(candidates.length){
  candidates.sort((a,b)=>(a.updatedAt||a.startedAt).localeCompare(b.updatedAt||b.startedAt));
  active=structuredClone(candidates.at(-1));
  if(candidates.length===2&&candidates[0].id===active.id)active.index=Math.max(active.index,candidates[0].index);
  for(const s of candidates){if(s.id!==active.id&&attempts.some(a=>a.sessionId===s.id))sessions.set(s.id,{...s,finishedAt:s.updatedAt||s.startedAt,completed:false});}
 }
 const canonical=s=>{const answers=attempts.filter(a=>a.sessionId===s.id&&s.ids.includes(a.questionId));return {...s,answers,completed:answers.length===s.ids.length,draft:answers.some(a=>a.questionId===s.ids[s.index])?null:s.draft};};
 return {schema:1,attempts,sessions:[...sessions.values()].map(canonical).sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt)),active:active?canonical(active):null};
}
const messages={invalid_code:'학습 코드를 다시 확인해 주세요.',unauthorized:'접속이 만료됐어요. 학습 코드를 다시 입력해 주세요.',too_many_requests:'코드를 여러 번 입력했어요. 10분 뒤 다시 시도해 주세요.',server_error:'서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',not_ready:'학습 공간을 준비하고 있어요. 잠시 후 다시 열어 주세요.',invalid_state:'학습 기록을 저장하지 못했어요. 이 기기의 기록은 보관되어 있어요.'};
export class CloudSync{
 constructor({onStatus=()=>{},onRemote=()=>{},validate=()=>true,storage=localStorage,transport=fetch,delay=700}={}){Object.assign(this,{onStatus,onRemote,validate,storage,transport,delay});this.token=storage.getItem(TOKEN_KEY);this.revision=0;this.pending=null;this.running=null;this.timer=null;this.current=null;this.generation=0;}
 async api(action,args={}){let r;try{r=await this.transport(API_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token:this.token,...args}),cache:'no-store',keepalive:action==='logout'});}catch{throw Object.assign(Error(messages.server_error),{code:'network'});}let data;try{data=await r.json();}catch{throw Error(messages.server_error);}if(data.error||!r.ok){const code=data.error||'server_error';throw Object.assign(Error(messages[code]||messages.server_error),{code});}return data;}
 pendingOnDisk(){try{return JSON.parse(this.storage.getItem(META_KEY)||'{}').pending===true;}catch{return false;}}
 markPending(value){this.storage.setItem(META_KEY,JSON.stringify({revision:this.revision,pending:value}));}
 async open(data,cached){
  if(!this.validate(data.state))throw Error(messages.invalid_state);
  if(data.token){this.token=data.token;this.storage.setItem(TOKEN_KEY,data.token);}
  this.revision=data.revision;this.current=data.state;
  if(this.pendingOnDisk()&&cached){this.pending=mergeStates(data.state,cached);await this.flush();if(this.pending)throw Error('아직 보내지 못한 기록이 있어요. 연결을 확인한 뒤 다시 시도해 주세요.');}
  this.onStatus('saved');return this.current;
 }
 async login(code,cached){return this.open(await this.api('login',{code}),cached);}
 async restore(cached){return this.open(await this.api('read'),cached);}
 enqueue(state){this.pending=structuredClone(state);this.markPending(true);this.onStatus('pending');clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),this.delay);}
 async flush(){if(this.running)return this.running;if(!this.token||!this.pending)return;clearTimeout(this.timer);const generation=this.generation;
  this.running=(async()=>{try{let retries=0;while(this.pending&&generation===this.generation){const snapshot=this.pending;this.pending=null;
   let data;try{data=await this.api('write',{revision:this.revision,state:snapshot});}catch(e){this.pending=this.pending?mergeStates(snapshot,this.pending):snapshot;throw e;}
   if(generation!==this.generation)return;
   if(!this.validate(data.state))throw Error(messages.invalid_state);
   this.revision=data.revision;
   if(data.conflict){this.pending=mergeStates(data.state,this.pending?mergeStates(snapshot,this.pending):snapshot);if(++retries>4)throw Error('다른 기기에서도 저장 중이에요. 잠시 후 다시 저장해 주세요.');continue;}
   this.current=data.state;
   if(this.pending)this.pending=mergeStates(data.state,this.pending);
   else {this.markPending(false);this.onRemote(data.state);this.onStatus('saved');}
  }}catch(e){this.markPending(true);this.onStatus(e.code==='unauthorized'?'expired':'offline',e.message);}finally{this.running=null;}})();return this.running;
 }
 async refresh(){if(this.running)await this.running;if(this.pending){await this.flush();if(this.pending)throw Error(messages.server_error);return this.current;}const data=await this.api('read');if(!this.validate(data.state))throw Error(messages.invalid_state);this.revision=data.revision;this.current=data.state;this.onRemote(data.state);this.onStatus('saved');return data.state;}
 async logout(){await this.flush();if(this.pending)throw Error('아직 서버로 보내지 못한 기록이 있어요. 저장을 마친 뒤 나가 주세요.');await this.api('logout');this.generation++;this.token=null;clearTimeout(this.timer);this.storage.removeItem(TOKEN_KEY);this.storage.removeItem(CLOUD_KEY);this.storage.removeItem(META_KEY);}
}
