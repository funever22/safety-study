const allowedOrigin='https://funever22.github.io';
const headers={'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!==allowedOrigin)return reply({error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 try{
  if(Number(req.headers.get('content-length')||0)>5500000)return reply({error:'invalid_state'},413);
  const text=await req.text();if(text.length>5500000)return reply({error:'invalid_state'},413);
  const body=JSON.parse(text),action=body.action;
  if(!['login','read','write','logout'].includes(action))return reply({error:'invalid_action'},400);
  if(action!=='login'&&!/^[a-f0-9]{64}$/.test(body.token||''))return reply({error:'unauthorized'},401);
  const secrets=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const secret=secrets.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!secret)return reply({error:'server_error'},503);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  // Only a keyed digest of the address is kept in the short-lived rate-limit buckets.
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip));
  const ipHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const args=action==='login'?{code:body.code,ip:ipHash}:{token:body.token,...(action==='write'?{state:body.state,revision:body.revision}:{})};
  const r=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/safety_study_rpc',{method:'POST',headers:{apikey:secret,...(secret.startsWith('ey')?{Authorization:'Bearer '+secret}:{}),'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_args:args})});
  if(!r.ok){const problem=await r.json().catch(()=>({}));console.error('safety_rpc_error',r.status,problem.code||'unknown',problem.message||'');return reply({error:'server_error'},503);}
  const data=await r.json();const status=data.error==='unauthorized'?401:data.error==='invalid_code'?401:data.error==='too_many_requests'?429:data.error?400:200;
  return reply(data,status);
 }catch(error){console.error('safety_sync_failure',error instanceof Error?error.name:'unknown');return reply({error:'server_error'},503);}
});
