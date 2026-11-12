export const STORAGE_KEY='songhak-safety-study-v1';
export const fresh=()=>({schema:1,attempts:[],sessions:[],active:null});
export const normalize=s=>String(s).normalize('NFC').replace(/\s/gu,'').toLocaleLowerCase('en');
export function grade(q,answer){return q.type==='short'?q.acceptedAnswers.some(a=>normalize(a)===normalize(answer)):answer===q.answer;}
export function shuffle(items,rng=Math.random){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export const sizes=n=>[...new Set([10,20,n].filter(v=>v>0&&v<=n))];
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function begin(state,ids,count,mode,topic=null,rng=Math.random){
 if(state.active)throw Error('진행 중인 학습이 있어요. 먼저 이어서 풀어 주세요.');
 const unique=[...new Set(ids)];if(!Number.isInteger(count)||count<1||count>unique.length)throw Error('문제 수를 다시 선택해 주세요.');
 const next=structuredClone(state);next.active={id:uid(),ids:shuffle(unique,rng).slice(0,count),mode,topic,index:0,startedAt:new Date().toISOString(),answers:[],draft:null};return next;
}
export function submit(state,bank,answer){
 const next=structuredClone(state),s=next.active;if(!s)throw Error('진행 중인 학습이 없어요.');
 const q=bank.find(q=>q.id===s.ids[s.index]);if(!q)throw Error('문제를 불러올 수 없어요.');
 if(s.answers.some(a=>a.questionId===q.id))return next;
 const valid=q.type==='choice'?Number.isInteger(answer)&&answer>=0&&answer<q.options.length:q.type==='ox'?['O','X'].includes(answer):typeof answer==='string'&&normalize(answer).length>0&&answer.length<=200;
 if(!valid)throw Error('먼저 답을 선택하거나 입력해 주세요.');
 const a={id:uid(),sessionId:s.id,questionId:q.id,topic:q.topic,answer,correct:grade(q,answer),mode:s.mode,at:new Date().toISOString()};
 next.attempts.push(a);s.answers.push(a);s.draft=null;return next;
}
export function advance(state){const n=structuredClone(state),s=n.active;if(!s||!s.answers.some(a=>a.questionId===s.ids[s.index]))throw Error('정답을 먼저 확인해 주세요.');if(s.index<s.ids.length-1){s.index++;s.draft=null;}return n;}
export function finish(state){const n=structuredClone(state),s=n.active;if(!s)return n;n.sessions.push({...s,finishedAt:new Date().toISOString(),completed:s.answers.length===s.ids.length});n.active=null;return n;}
export function reviews(state){const map={};for(const a of state.attempts){if(!a.correct)map[a.questionId]={done:false,lastAt:a.at};else if(a.mode==='review'&&map[a.questionId])map[a.questionId]={done:true,lastAt:a.at};}return map;}
export function stats(state){const total=state.attempts.length,correct=state.attempts.filter(a=>a.correct).length;const r=Object.values(reviews(state));return {total,correct,rate:total?Math.round(correct/total*100):0,pending:r.filter(x=>!x.done).length,done:r.filter(x=>x.done).length};}
export function validateState(s,bank){
 const ids=new Set(bank.map(q=>q.id));
 const validA=a=>a&&typeof a.id==='string'&&typeof a.sessionId==='string'&&ids.has(a.questionId)&&typeof a.correct==='boolean'&&['topic','random','review'].includes(a.mode)&&typeof a.at==='string';
 const validS=v=>v&&typeof v.id==='string'&&Array.isArray(v.ids)&&v.ids.length>0&&new Set(v.ids).size===v.ids.length&&v.ids.every(x=>ids.has(x))&&Array.isArray(v.answers)&&v.answers.every(validA)&&new Set(v.answers.map(a=>a.questionId)).size===v.answers.length&&v.answers.every(a=>v.ids.includes(a.questionId))&&Number.isInteger(v.index)&&v.index>=0&&v.index<v.ids.length;
 return !!(s&&s.schema===1&&Array.isArray(s.attempts)&&s.attempts.every(validA)&&new Set(s.attempts.map(a=>a.id)).size===s.attempts.length&&Array.isArray(s.sessions)&&s.sessions.every(validS)&&(!s.active||validS(s.active)));
}
