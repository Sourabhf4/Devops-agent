import { useState, useEffect, useRef, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = "devops_agent_creds_v3";
const BACKEND_URL = "http://localhost:8000";

const GROQ_MODELS = [
  { value: "llama-3.1-8b-instant",         label: "Llama 3.1 · 8B Instant" },
  { value: "llama3-70b-8192",              label: "Llama 3 · 70B (recommended)" },
  { value: "llama-3.3-70b-versatile",      label: "Llama 3.3 · 70B Versatile" },
  { value: "llama-3.1-70b-versatile",      label: "Llama 3.1 · 70B Versatile" },
  { value: "llama-3.2-90b-vision-preview", label: "Llama 3.2 · 90B Vision" },
  { value: "mixtral-8x7b-32768",           label: "Mixtral · 8x7B" },
  { value: "llama3-8b-8192",               label: "Llama 3 · 8B" },
  { value: "gemma2-9b-it",                 label: "Gemma 2 · 9B" },
];

const AWS_REGIONS = [
  "us-east-1","us-east-2","us-west-1","us-west-2",
  "ap-south-1","ap-southeast-1","ap-southeast-2","ap-northeast-1",
  "eu-west-1","eu-west-2","eu-central-1","sa-east-1","ca-central-1",
];

const MODULES = {
  docker:     { icon:"🐳", label:"Docker",      subtitle:"Container Management",  title:"DOCKER · devops-agent",      placeholder:"Ask about containers, images, volumes...",    quickCmds:["docker ps -a","docker images","docker stats","docker logs <id>"] },
  system:     { icon:"🖥",  label:"System",      subtitle:"Host Monitoring",       title:"SYSTEM · devops-agent",      placeholder:"Ask about system resources, processes...",    quickCmds:["df -h","top","free -h","ps aux | head -20"] },
  kubernetes: { icon:"☸",  label:"Kubernetes",  subtitle:"Cluster Orchestration", title:"KUBERNETES · devops-agent",  placeholder:"Ask about pods, deployments, services...",    quickCmds:["kubectl get pods","kubectl get nodes","kubectl get svc","kubectl describe pod <n>"] },
  aws:        { icon:"☁",  label:"AWS Cloud",   subtitle:"Cloud Infrastructure",  title:"CLOUD (AWS) · devops-agent", placeholder:"Ask about EC2, S3, Lambda, ECS...",           quickCmds:["aws s3 ls","aws ec2 describe-instances","aws ecs list-clusters","aws lambda list-functions"] },
  network:    { icon:"🔗", label:"Network",     subtitle:"Connectivity & DNS",     title:"NETWORK · devops-agent",     placeholder:"Ask about networking, DNS, ports...",         quickCmds:["netstat -tulpn","ping <host>","curl -I <url>","nslookup <domain>"] },
  logs:       { icon:"📋", label:"Logs",        subtitle:"Log Analysis",           title:"LOGS · devops-agent",        placeholder:"Ask about log analysis, errors...",           quickCmds:["tail -f /var/log/syslog","journalctl -xe","docker logs <id>","grep -r ERROR /var/log/"] },
};

const DEFAULT_CREDS = {
  groq:        { key: "", model: "llama-3.3-70b-versatile" },
  awsAccounts: [
    { id: "aws-1", name: "Primary AWS", access: "", secret: "", region: "us-east-1", bucket: "", active: true }
  ],
  sshHosts: [
    { id: "ssh-1", name: "Remote host 1", host: "", user: "", key: "", active: true }
  ],
  docker:      { registry: "", user: "", pass: "" },
  k8s:         { config: "", ns: "default" },
  backendUrl:  BACKEND_URL,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const timeStr = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const escHtml = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = () => Math.random().toString(36).slice(2,9);

function formatContent(text) {
  const parts = [], re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type:"text", content: text.slice(last, m.index) });
    parts.push({ type:"code", content: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type:"text", content: text.slice(last) });
  return parts;
}

function inlineFormat(str) {
  return str
    .replace(/`([^`]+)`/g, '<code style="background:#1a1e28;padding:1px 5px;border-radius:3px;font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#06b6d4">$1</code>')
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

// ── ThinkingDots ─────────────────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#64748b",fontFamily:"'JetBrains Mono',monospace",padding:"8px 0"}}>
      <div style={{display:"flex",gap:3}}>
        {[0,0.2,0.4].map((d,i) => (
          <span key={i} style={{width:4,height:4,borderRadius:"50%",background:"#3b82f6",display:"inline-block",animation:`blink 1.2s ${d}s infinite`}}/>
        ))}
      </div>
      agent processing...
    </div>
  );
}

// ── MsgBubble ─────────────────────────────────────────────────────────────────
function MsgBubble({ role, content, time }) {
  const parts = formatContent(content);

  const renderTable = (text) => {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines[0].includes(" ")) {
      const headers = lines[0].split(/\s{2,}|\t+/).filter(Boolean);
      if (headers.length >= 2) {
        const rows = lines.slice(1).map(line => line.split(/\s{2,}|\t+/).filter(Boolean));
        return (
          <div style={{overflowX:"auto",border:"1px solid #1e293b",borderRadius:8,marginTop:10,background:"#060b14"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
              <thead>
                <tr style={{background:"#0d1220"}}>
                  {headers.map((h,i) => (
                    <th key={i} style={{padding:"10px 12px",textAlign:"left",color:"#94a3b8",borderBottom:"1px solid #1e293b",whiteSpace:"nowrap",fontWeight:600,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row,ri) => (
                  <tr key={ri} style={{borderBottom:"1px solid #0f172a"}}>
                    {headers.map((_,ci) => (
                      <td key={ci} style={{padding:"9px 12px",color:"#cbd5e1",whiteSpace:"nowrap",fontSize:12}}>{row[ci]||"-"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
    return <div dangerouslySetInnerHTML={{__html: text.split("\n").map(l => inlineFormat(escHtml(l))).join("<br/>")}} />;
  };

  return (
    <div style={{maxWidth:"92%",alignSelf:role==="ai"?"flex-start":"flex-end"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
        {role === "ai" ? (
          <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:4,fontFamily:"'JetBrains Mono',monospace",background:"rgba(59,130,246,0.1)",color:"#3b82f6",border:"1px solid rgba(59,130,246,0.25)",letterSpacing:"0.05em"}}>AGENT</span>
        ) : (
          <span style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:4,fontFamily:"'JetBrains Mono',monospace",background:"rgba(100,116,139,0.15)",color:"#94a3b8",border:"1px solid rgba(100,116,139,0.25)",letterSpacing:"0.05em"}}>YOU</span>
        )}
        <span style={{fontSize:10,color:"#475569",fontFamily:"'JetBrains Mono',monospace"}}>{time}</span>
      </div>
      <div style={{
        background: role==="ai" ? "linear-gradient(135deg,#0f172a,#0a0f1a)" : "#13161e",
        border: "1px solid #1e293b",
        borderLeft: `3px solid ${role==="ai"?"#3b82f6":"#475569"}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)"
      }}>
        {role === "ai" && (
          <div style={{height:28,background:"#0d1220",borderBottom:"1px solid #1e293b",display:"flex",alignItems:"center",padding:"0 10px",gap:5}}>
            {["#ef4444","#f59e0b","#10b981"].map((c,i) => <span key={i} style={{width:8,height:8,borderRadius:"50%",background:c,opacity:0.7}}/>)}
          </div>
        )}
        <div style={{padding:"14px 16px",fontSize:13,lineHeight:1.75,color:"#cbd5e1"}}>
          {parts.map((p,i) =>
            p.type === "code" ? (
              <div key={i}>
                <div style={{fontSize:10,color:"#475569",marginBottom:6,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.06em"}}>$ output</div>
                <pre style={{background:"#020617",border:"1px solid #1e293b",borderRadius:8,padding:"12px",overflowX:"auto",color:"#22d3ee",fontFamily:"'JetBrains Mono',monospace",fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{p.content}</pre>
                {renderTable(p.content)}
              </div>
            ) : (
              <div key={i}>{renderTable(p.content)}</div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function CredField({label,type="text",placeholder,value,onChange,hint}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:"#64748b",fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</label>
      <input type={type} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)} autoComplete="off"
        style={{background:"#080b10",border:"1px solid #1e293b",color:"#e2e8f0",padding:"8px 12px",borderRadius:6,fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none",width:"100%"}}
        onFocus={e=>(e.target.style.borderColor="#3b82f6")} onBlur={e=>(e.target.style.borderColor="#1e293b")}/>
      {hint && <span style={{fontSize:11,color:"#475569"}}>{hint}</span>}
    </div>
  );
}

function CredSelect({label,value,onChange,options}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:"#64748b",fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{background:"#080b10",border:"1px solid #1e293b",color:"#e2e8f0",padding:"8px 12px",borderRadius:6,fontFamily:"'JetBrains Mono',monospace",fontSize:12,outline:"none",width:"100%",cursor:"pointer"}}>
        {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  );
}

function CredTextarea({label,placeholder,value,onChange,rows=4}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:11,color:"#64748b",fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</label>
      <textarea placeholder={placeholder} value={value} rows={rows} onChange={e=>onChange(e.target.value)}
        style={{background:"#080b10",border:"1px solid #1e293b",color:"#e2e8f0",padding:"8px 12px",borderRadius:6,fontFamily:"'JetBrains Mono',monospace",fontSize:11,lineHeight:1.5,outline:"none",width:"100%",resize:"vertical"}}
        onFocus={e=>(e.target.style.borderColor="#3b82f6")} onBlur={e=>(e.target.style.borderColor="#1e293b")}/>
    </div>
  );
}

// ── SSH Host Card ─────────────────────────────────────────────────────────────
function SSHHostCard({ host, onUpdate, onRemove, isOnly }) {
  const [expanded, setExpanded] = useState(!host.host);
  const set = (field) => (val) => onUpdate({ ...host, [field]: val });

  return (
    <div style={{border:"1px solid #1e293b",borderRadius:8,overflow:"hidden",background:"#080b10"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",background:"#0d1220"}} onClick={() => setExpanded(e => !e)}>
        <span style={{width:8,height:8,borderRadius:"50%",background:host.host&&host.user?"#10b981":"#475569",boxShadow:host.host&&host.user?"0 0 6px #10b981":"none",flexShrink:0}}/>
        <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0",flex:1,fontFamily:"'JetBrains Mono',monospace"}}>{host.name||"Unnamed Host"}</span>
        {host.host && <span style={{fontSize:11,color:"#475569",fontFamily:"'JetBrains Mono',monospace"}}>{host.user}@{host.host}</span>}
        <span style={{fontSize:11,color:"#475569",marginLeft:4}}>{expanded?"▲":"▼"}</span>
      </div>
      {expanded && (
        <div style={{padding:12,display:"flex",flexDirection:"column",gap:10}}>
          <CredField label="Display Name" placeholder="Production Server" value={host.name} onChange={set("name")}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <CredField label="Host / IP" placeholder="192.168.1.100" value={host.host} onChange={set("host")}/>
            <CredField label="Username" placeholder="ubuntu" value={host.user} onChange={set("user")}/>
          </div>
          <CredTextarea label="SSH Private Key (PEM)" placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"} value={host.key} onChange={set("key")} rows={3}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:11,color:"#475569"}}>Leave key blank to use SSH agent or ~/.ssh/id_rsa</span>
            {!isOnly && (
              <button onClick={() => onRemove(host.id)}
                style={{fontSize:11,color:"#ef4444",background:"transparent",border:"1px solid rgba(239,68,68,0.3)",padding:"4px 10px",borderRadius:4,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AWS Account Card ──────────────────────────────────────────────────────────
function AWSAccountCard({ account, onUpdate, onRemove, isOnly }) {
  const [expanded, setExpanded] = useState(!account.access);
  const set = (field) => (val) => onUpdate({ ...account, [field]: val });

  return (
    <div style={{border:"1px solid #1e293b",borderRadius:8,overflow:"hidden",background:"#080b10"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",background:"#0d1220"}} onClick={() => setExpanded(e => !e)}>
        <span style={{width:8,height:8,borderRadius:"50%",background:account.access&&account.secret?"#10b981":"#475569",boxShadow:account.access&&account.secret?"0 0 6px #10b981":"none",flexShrink:0}}/>
        <span style={{fontSize:13,fontWeight:600,color:"#e2e8f0",flex:1,fontFamily:"'JetBrains Mono',monospace"}}>{account.name||"Unnamed Account"}</span>
        {account.region && <span style={{fontSize:11,color:"#475569",fontFamily:"'JetBrains Mono',monospace"}}>{account.region}</span>}
        <span style={{fontSize:11,color:"#475569",marginLeft:4}}>{expanded?"▲":"▼"}</span>
      </div>
      {expanded && (
        <div style={{padding:12,display:"flex",flexDirection:"column",gap:10}}>
          <CredField label="Account Name" placeholder="Primary AWS / Staging / Production" value={account.name} onChange={set("name")}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <CredField label="Access Key ID" type="password" placeholder="AKIAIOSFODNN7EXAMPLE" value={account.access} onChange={set("access")}/>
            <CredField label="Secret Access Key" type="password" placeholder="wJalrXUtn..." value={account.secret} onChange={set("secret")}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <CredSelect label="Region" value={account.region} onChange={set("region")} options={AWS_REGIONS}/>
            <CredField label="S3 Bucket (optional)" placeholder="my-bucket-name" value={account.bucket||""} onChange={set("bucket")}/>
          </div>
          {!isOnly && (
            <div style={{display:"flex",justifyContent:"flex-end"}}>
              <button onClick={() => onRemove(account.id)}
                style={{fontSize:11,color:"#ef4444",background:"transparent",border:"1px solid rgba(239,68,68,0.3)",padding:"4px 10px",borderRadius:4,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>
                Remove Account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Credentials Modal ─────────────────────────────────────────────────────────
function CredentialsModal({ creds, onSave, onClose }) {
  const [local, setLocal] = useState(creds);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState("groq");

  const handleSave = () => { onSave(local); setSaved(true); setTimeout(() => setSaved(false), 2500); };

  // SSH helpers
  const updateSSH = (updated) => setLocal(p => ({ ...p, sshHosts: p.sshHosts.map(h => h.id === updated.id ? updated : h) }));
  const removeSSH = (id) => setLocal(p => ({ ...p, sshHosts: p.sshHosts.filter(h => h.id !== id) }));
  const addSSH = () => setLocal(p => ({ ...p, sshHosts: [...p.sshHosts, { id: uid(), name: `Host ${p.sshHosts.length+1}`, host:"", user:"", key:"", active:false }] }));

  // AWS helpers
  const updateAWS = (updated) => setLocal(p => ({ ...p, awsAccounts: p.awsAccounts.map(a => a.id === updated.id ? updated : a) }));
  const removeAWS = (id) => setLocal(p => ({ ...p, awsAccounts: p.awsAccounts.filter(a => a.id !== id) }));
  const addAWS = () => setLocal(p => ({ ...p, awsAccounts: [...p.awsAccounts, { id: uid(), name: `AWS Account ${p.awsAccounts.length+1}`, access:"", secret:"", region:"us-east-1", bucket:"", active:false }] }));

  const tabs = [
    { key:"groq", label:"⚡ Groq / LLM" },
    { key:"ssh",  label:`🖥 SSH Hosts (${local.sshHosts.length})` },
    { key:"aws",  label:`☁ AWS (${local.awsAccounts.length})` },
    { key:"docker", label:"🐳 Docker" },
    { key:"k8s",  label:"☸ Kubernetes" },
    { key:"backend", label:"🔌 Backend" },
  ];

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
      <div style={{background:"#0d1117",border:"1px solid #1e293b",borderRadius:14,width:580,maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 30px 80px rgba(0,0,0,0.7)"}}>

        <div style={{padding:"16px 20px",borderBottom:"1px solid #1e293b",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:700,letterSpacing:"0.03em"}}>🔑 Credentials & Configuration</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:18,padding:"2px 8px",borderRadius:4}}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:2,padding:"8px 16px",borderBottom:"1px solid #1e293b",flexShrink:0,overflowX:"auto"}}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:600,whiteSpace:"nowrap",
                background: activeTab===t.key ? "#1e293b" : "transparent",
                color: activeTab===t.key ? "#e2e8f0" : "#64748b",
                transition:"all 0.15s"
              }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{overflowY:"auto",padding:20,flex:1,display:"flex",flexDirection:"column",gap:14}}>

          {activeTab === "groq" && (
            <>
              <div style={{background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.15)",borderRadius:6,padding:"10px 12px",fontSize:12,color:"#94a3b8",lineHeight:1.6}}>
                <strong style={{color:"#3b82f6"}}>Required:</strong> Groq API key powers all AI reasoning. Get yours at <strong style={{color:"#e2e8f0"}}>console.groq.com</strong>
              </div>
              <CredField label="Groq API Key" type="password" placeholder="gsk_..." value={local.groq.key}
                onChange={v => setLocal(p=>({...p,groq:{...p.groq,key:v}}))}/>
              <CredSelect label="Model" value={local.groq.model}
                onChange={v => setLocal(p=>({...p,groq:{...p.groq,model:v}}))} options={GROQ_MODELS}/>
            </>
          )}

          {activeTab === "ssh" && (
            <>
              <div style={{background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.15)",borderRadius:6,padding:"10px 12px",fontSize:12,color:"#94a3b8",lineHeight:1.6}}>
                Add multiple SSH hosts. Commands will be routed to the <strong style={{color:"#10b981"}}>active target</strong> selected in the header dropdown.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {local.sshHosts.map(h => (
                  <SSHHostCard key={h.id} host={h} onUpdate={updateSSH} onRemove={removeSSH} isOnly={local.sshHosts.length===1}/>
                ))}
              </div>
              <button onClick={addSSH}
                style={{padding:"9px",border:"1px dashed #2a3344",borderRadius:8,background:"transparent",color:"#475569",cursor:"pointer",fontSize:12,fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.target.style.borderColor="#3b82f6";e.target.style.color="#3b82f6";}}
                onMouseLeave={e=>{e.target.style.borderColor="#2a3344";e.target.style.color="#475569";}}>
                + Add SSH Host
              </button>
            </>
          )}

          {activeTab === "aws" && (
            <>
              <div style={{background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.15)",borderRadius:6,padding:"10px 12px",fontSize:12,color:"#94a3b8",lineHeight:1.6}}>
                Manage multiple AWS accounts. Switch between them using the <strong style={{color:"#f59e0b"}}>AWS account dropdown</strong> in the header.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {local.awsAccounts.map(a => (
                  <AWSAccountCard key={a.id} account={a} onUpdate={updateAWS} onRemove={removeAWS} isOnly={local.awsAccounts.length===1}/>
                ))}
              </div>
              <button onClick={addAWS}
                style={{padding:"9px",border:"1px dashed #2a3344",borderRadius:8,background:"transparent",color:"#475569",cursor:"pointer",fontSize:12,fontFamily:"'JetBrains Mono',monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.target.style.borderColor="#f59e0b";e.target.style.color="#f59e0b";}}
                onMouseLeave={e=>{e.target.style.borderColor="#2a3344";e.target.style.color="#475569";}}>
                + Add AWS Account
              </button>
            </>
          )}

          {activeTab === "docker" && (
            <>
              <CredField label="Registry URL" placeholder="registry.hub.docker.com" value={local.docker.registry}
                onChange={v=>setLocal(p=>({...p,docker:{...p.docker,registry:v}}))}/>
              <CredField label="Username" placeholder="username" value={local.docker.user}
                onChange={v=>setLocal(p=>({...p,docker:{...p.docker,user:v}}))}/>
              <CredField label="Password / Token" type="password" placeholder="••••••••" value={local.docker.pass}
                onChange={v=>setLocal(p=>({...p,docker:{...p.docker,pass:v}}))}/>
            </>
          )}

          {activeTab === "k8s" && (
            <>
              <CredTextarea label="kubeconfig (paste YAML)" placeholder={"apiVersion: v1\nclusters:\n  - name: my-cluster..."} value={local.k8s.config}
                onChange={v=>setLocal(p=>({...p,k8s:{...p.k8s,config:v}}))}/>
              <CredField label="Namespace" placeholder="default" value={local.k8s.ns}
                onChange={v=>setLocal(p=>({...p,k8s:{...p.k8s,ns:v}}))}/>
            </>
          )}

          {activeTab === "backend" && (
            <>
              <CredField label="FastAPI Backend URL" placeholder="http://localhost:8000" value={local.backendUrl||BACKEND_URL}
                onChange={v=>setLocal(p=>({...p,backendUrl:v}))} hint="Where your Python backend (main.py) is running"/>
            </>
          )}

        </div>

        <div style={{padding:"14px 20px",borderTop:"1px solid #1e293b",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <span style={{fontSize:11,color:"#10b981",opacity:saved?1:0,transition:"opacity 0.3s",fontFamily:"'JetBrains Mono',monospace"}}>✓ Saved to browser</span>
          <button onClick={handleSave}
            style={{padding:"8px 22px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:6,cursor:"pointer",fontSize:13,fontWeight:700,letterSpacing:"0.04em",fontFamily:"'JetBrains Mono',monospace"}}>
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function HeaderDropdown({ label, value, options, onSelect, accent="#3b82f6" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{position:"relative"}}>
      <div onClick={() => setOpen(o => !o)}
        style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",background:"#0d1220",border:`1px solid ${open?"#1e3a5f":"#1e293b"}`,borderRadius:8,cursor:"pointer",minWidth:160}}>
        <span style={{width:7,height:7,borderRadius:"50%",background:accent,boxShadow:`0 0 5px ${accent}`,flexShrink:0}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:"#475569",fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",lineHeight:1.2}}>{label}</div>
          <div style={{fontSize:12,color:"#e2e8f0",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160}}>{value}</div>
        </div>
        <span style={{fontSize:9,color:"#475569"}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:200,background:"#0d1220",border:"1px solid #1e293b",borderRadius:8,boxShadow:"0 12px 40px rgba(0,0,0,0.6)",zIndex:50,overflow:"hidden"}}>
          {options.map((o, i) => (
            <div key={i} onClick={() => { onSelect(o); setOpen(false); }}
              style={{padding:"9px 14px",fontSize:12,fontFamily:"'JetBrains Mono',monospace",color: o.value===value||o.label===value?"#3b82f6":"#94a3b8",cursor:"pointer",borderBottom:i<options.length-1?"1px solid #0f172a":"none",display:"flex",alignItems:"center",gap:8,transition:"background 0.1s"}}
              onMouseEnter={e => e.currentTarget.style.background="#1e293b"}
              onMouseLeave={e => e.currentTarget.style.background="transparent"}>
              {o.icon && <span>{o.icon}</span>}
              <span style={{flex:1}}>{o.label||o.value}</span>
              {(o.value===value||o.label===value) && <span style={{fontSize:10,color:"#3b82f6"}}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function DevOpsAgent() {
  const [currentModule, setCurrentModule] = useState("docker");
  const [creds, setCreds] = useState(DEFAULT_CREDS);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showCredModal, setShowCredModal] = useState(false);
  const [activeSSHId, setActiveSSHId] = useState(null);
  const [activeAWSId, setActiveAWSId] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setCreds(prev => ({ ...prev, ...parsed }));
        if (parsed.sshHosts?.length) setActiveSSHId(parsed.sshHosts[0].id);
        if (parsed.awsAccounts?.length) setActiveAWSId(parsed.awsAccounts[0].id);
      } else {
        setActiveSSHId(DEFAULT_CREDS.sshHosts[0].id);
        setActiveAWSId(DEFAULT_CREDS.awsAccounts[0].id);
      }
    } catch {}
    setMessages([{
      role: "ai",
      content: "DevOps AI Agent ready.\n\nUse the **TARGET** and **AWS Account** dropdowns in the header to switch between hosts and cloud accounts.\n\n⚠ Open **Credentials & API Keys** → add your Groq key and configure SSH hosts / AWS accounts to get started.",
      time: timeStr()
    }]);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, isProcessing]);

  // Sync active IDs when creds change
  useEffect(() => {
    if (!creds.sshHosts.find(h => h.id === activeSSHId)) setActiveSSHId(creds.sshHosts[0]?.id || null);
    if (!creds.awsAccounts.find(a => a.id === activeAWSId)) setActiveAWSId(creds.awsAccounts[0]?.id || null);
  }, [creds]);

  const saveCreds = useCallback((newCreds) => {
    setCreds(newCreds);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newCreds)); } catch {}
  }, []);

  const activeSSH = creds.sshHosts.find(h => h.id === activeSSHId) || creds.sshHosts[0];
  const activeAWS = creds.awsAccounts.find(a => a.id === activeAWSId) || creds.awsAccounts[0];

  const handleSwitchModule = (mod) => {
    setCurrentModule(mod);
    setSessionId(null);
    setMessages([{ role:"ai", content:`Switched to **${mod.toUpperCase()}** module. New session started.`, time:timeStr() }]);
  };

  const buildConfig = () => ({
    groq_key:   creds.groq?.key || "",
    groq_model: creds.groq?.model || "llama-3.1-8b-instant",
    aws: {
      access: activeAWS?.access || "",
      secret: activeAWS?.secret || "",
      region: activeAWS?.region || "us-east-1",
      bucket: activeAWS?.bucket || "",
    },
    target: {
      host: activeSSH?.host || "",
      user: activeSSH?.user || "",
      key:  activeSSH?.key  || "",
    },
  });

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || isProcessing) return;
    setInput("");
    if (!creds.groq?.key) {
      setMessages(prev => [...prev, { role:"ai", content:"⚠️ No Groq API key. Open **Credentials & API Keys** in the sidebar.", time:timeStr() }]);
      return;
    }
    setMessages(prev => [...prev, { role:"user", content:msg, time:timeStr() }]);
    setIsProcessing(true);
    const backendUrl = creds.backendUrl || BACKEND_URL;
    try {
      const res = await fetch(`${backendUrl}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message:msg, session_id:sessionId, config:buildConfig() }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Backend error ${res.status}`); }
      const data = await res.json();
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      let content = "";
      if (data.question)              content = `❓ ${data.question}`;
      else if (data.command && data.output) content = `🖥 **Command ready:**\n\`\`\`\n${data.command}\n\`\`\`\n${data.output}`;
      else if (data.output)           content = data.output;
      else                            content = JSON.stringify(data);
      setMessages(prev => [...prev, { role:"ai", content, time:timeStr() }]);
    } catch (err) {
      setMessages(prev => [...prev, { role:"ai", content:`❌ **Error:** ${err.message}\n\nMake sure your backend is running at \`${backendUrl}\`.`, time:timeStr() }]);
    }
    setIsProcessing(false);
  };

  const handleKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const mod = MODULES[currentModule];
  const hasSSH = !!(activeSSH?.host && activeSSH?.user);
  const hasAWS = !!(activeAWS?.access && activeAWS?.secret);

  // Options for dropdowns
  const sshOptions = creds.sshHosts.map(h => ({
    value: h.id,
    label: h.host ? `${h.name} · ${h.user}@${h.host}` : `${h.name} (not configured)`,
    icon: "🖥"
  }));
  const awsOptions = creds.awsAccounts.map(a => ({
    value: a.id,
    label: a.access ? `${a.name} · ${a.region}` : `${a.name} (not configured)`,
    icon: "☁"
  }));
  const modelOptions = GROQ_MODELS.map(m => ({ value: m.value, label: m.label }));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;} body{background:#080c14;}
        ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
        @keyframes blink{0%,100%{opacity:0.2}50%{opacity:1}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .msg-enter{animation:fadeUp 0.22s ease-out;}
        .mod-btn:hover{background:#0d1220 !important;color:#e2e8f0 !important;}
        .qcmd-pill:hover{border-color:#3b82f6 !important;color:#3b82f6 !important;}
        .rcmd-item:hover{color:#94a3b8 !important;}
        .send-btn:hover:not(:disabled){background:#2563eb !important;}
        .send-btn:disabled{opacity:0.35;cursor:not-allowed;}
      `}</style>

      <div style={{display:"flex",height:"100vh",overflow:"hidden",background:"#080c14",color:"#e2e8f0",fontFamily:"'Syne',sans-serif"}}>

        {/* ── Sidebar ── */}
        <div style={{width:220,minWidth:220,background:"#0a0e18",borderRight:"1px solid #1e293b",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Logo */}
          <div style={{padding:"14px 16px",borderBottom:"1px solid #1e293b",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,boxShadow:"0 0 16px rgba(59,130,246,0.35)"}}>⚙</div>
            <div>
              <div style={{fontSize:13,fontWeight:800,letterSpacing:"0.04em"}}>DevOps <span style={{color:"#3b82f6"}}>Agent</span></div>
              <div style={{fontSize:10,color:"#475569",letterSpacing:"0.08em",fontFamily:"'JetBrains Mono',monospace"}}>CONSOLE</div>
            </div>
          </div>

          {/* Modules */}
          <div style={{padding:"8px 0",flex:"0 0 auto"}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.14em",color:"#334155",textTransform:"uppercase",padding:"4px 16px 6px"}}>Modules</div>
            {Object.entries(MODULES).map(([key, m]) => (
              <button key={key} className="mod-btn" onClick={() => handleSwitchModule(key)}
                style={{display:"flex",alignItems:"center",gap:9,padding:"7px 16px",cursor:"pointer",fontSize:13,fontWeight:600,color:currentModule===key?"#3b82f6":"#64748b",background:currentModule===key?"#0d1220":"transparent",border:"none",width:"100%",textAlign:"left",position:"relative",transition:"all 0.15s",fontFamily:"'Syne',sans-serif"}}>
                {currentModule===key && <div style={{position:"absolute",left:0,top:0,bottom:0,width:2,background:"#3b82f6",borderRadius:"0 2px 2px 0"}}/>}
                <span style={{fontSize:13,width:16,textAlign:"center"}}>{m.icon}</span>
                {m.label}
                {currentModule===key && <span style={{width:5,height:5,borderRadius:"50%",background:"#10b981",marginLeft:"auto",boxShadow:"0 0 5px #10b981"}}/>}
              </button>
            ))}
          </div>

          {/* Quick Run */}
          <div style={{padding:"8px 0",flex:"0 0 auto"}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.14em",color:"#334155",textTransform:"uppercase",padding:"4px 16px 6px"}}>Quick Run</div>
            {mod.quickCmds.map(cmd => (
              <div key={cmd} className="rcmd-item" onClick={() => setInput(cmd)}
                style={{display:"flex",alignItems:"center",gap:5,padding:"4px 16px",fontSize:11,color:"#334155",fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",transition:"color 0.15s",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                <span style={{color:"#1e3a5f",fontSize:9}}>❯</span> {cmd}
              </div>
            ))}
          </div>

          {/* Creds button + status */}
          <div style={{marginTop:"auto",borderTop:"1px solid #1e293b",padding:"12px 14px"}}>
            <button onClick={() => setShowCredModal(true)}
              style={{display:"flex",alignItems:"center",gap:8,fontSize:12,fontWeight:600,color:creds.groq?.key?"#3b82f6":"#ef4444",cursor:"pointer",padding:"7px 10px",borderRadius:7,border:`1px solid ${creds.groq?.key?"rgba(59,130,246,0.2)":"rgba(239,68,68,0.2)"}`,background:creds.groq?.key?"rgba(59,130,246,0.05)":"rgba(239,68,68,0.05)",width:"100%",textAlign:"left",fontFamily:"'Syne',sans-serif",transition:"all 0.15s"}}>
              🔑 Credentials
              {!creds.groq?.key && <span style={{marginLeft:"auto",fontSize:10,color:"#ef4444"}}>⚠</span>}
            </button>
            <div style={{fontSize:10,color:"#334155",marginTop:8,padding:"0 4px",lineHeight:2.1,fontFamily:"'JetBrains Mono',monospace"}}>
              {[
                { dot: creds.groq?.key?"#10b981":"#ef4444", glow: !!creds.groq?.key, label: creds.groq?.key ? (creds.groq.model||"").split("-").slice(0,3).join("-") : "No Groq key" },
                { dot: hasAWS?"#10b981":"#334155", glow: hasAWS, label: hasAWS ? `${activeAWS.name} · ${activeAWS.region}` : "AWS not set" },
                { dot: hasSSH?"#10b981":"#334155", glow: hasSSH, label: hasSSH ? `${activeSSH.user}@${activeSSH.host}` : "SSH not set" },
                { dot: "#3b82f6", glow: false, label: (creds.backendUrl||BACKEND_URL).replace(/https?:\/\//,"") },
              ].map((s,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,overflow:"hidden"}}>
                  <span style={{width:5,height:5,borderRadius:"50%",background:s.dot,flexShrink:0,boxShadow:s.glow?`0 0 5px ${s.dot}`:"none"}}/>
                  <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Main area ── */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* ── Header ── */}
          <div style={{background:"#0a0e18",borderBottom:"1px solid #1e293b",padding:"10px 20px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
            {/* Module icon + title */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginRight:4}}>
              <div style={{width:36,height:36,background:"#0d1220",border:"1px solid #1e293b",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>
                {mod.icon}
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0"}}>{mod.label}</div>
                <div style={{fontSize:10,color:"#475569",fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.06em"}}>{mod.subtitle}</div>
              </div>
            </div>

            <div style={{height:32,width:1,background:"#1e293b",marginRight:4}}/>

            {/* TARGET dropdown */}
            <HeaderDropdown
              label="TARGET"
              value={activeSSH ? (activeSSH.host ? `${activeSSH.name} · ${activeSSH.user}@${activeSSH.host}` : activeSSH.name) : "No host"}
              options={[...sshOptions, { value:"__local__", label:"Local (no SSH)", icon:"💻" }]}
              onSelect={o => { if (o.value !== "__local__") setActiveSSHId(o.value); else setActiveSSHId(null); }}
              accent="#10b981"
            />

            {/* AWS Account dropdown */}
            <HeaderDropdown
              label="AWS ACCOUNT"
              value={activeAWS ? (activeAWS.access ? `${activeAWS.name} · ${activeAWS.region}` : activeAWS.name) : "No account"}
              options={awsOptions}
              onSelect={o => setActiveAWSId(o.value)}
              accent="#f59e0b"
            />

            {/* LLM dropdown */}
            <HeaderDropdown
              label="LLM"
              value={GROQ_MODELS.find(m => m.value===creds.groq?.model)?.label || creds.groq?.model || "Not set"}
              options={modelOptions}
              onSelect={o => saveCreds({ ...creds, groq: { ...creds.groq, model: o.value } })}
              accent="#3b82f6"
            />

            <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
              {/* Status badges */}
              {creds.groq?.key && (
                <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,padding:"4px 10px",borderRadius:5,background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.2)",color:"#10b981",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>
                  <span style={{width:5,height:5,borderRadius:"50%",background:"#10b981",boxShadow:"0 0 5px #10b981"}}/>
                  Groq ready
                </div>
              )}
              {sessionId && (
                <div style={{fontSize:11,padding:"4px 10px",borderRadius:5,background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.2)",color:"#3b82f6",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>
                  SID {sessionId.slice(0,8)}
                </div>
              )}
              <button onClick={() => { setSessionId(null); setMessages([{ role:"ai", content:"Session cleared. New session started.", time:timeStr() }]); }}
                style={{fontSize:11,padding:"4px 10px",borderRadius:5,background:"transparent",border:"1px solid #1e293b",color:"#475569",fontFamily:"'JetBrains Mono',monospace",cursor:"pointer",fontWeight:600,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.target.style.borderColor="#3b82f6";e.target.style.color="#3b82f6";}}
                onMouseLeave={e=>{e.target.style.borderColor="#1e293b";e.target.style.color="#475569";}}>
                NEW SESSION
              </button>
            </div>
          </div>

          {/* ── Workspace cards ── */}
          <div style={{background:"#080c14",borderBottom:"1px solid #1e293b",padding:"10px 20px",display:"flex",gap:10,flexShrink:0}}>
            {[
              { label:"WORKSPACE", title:mod.label, sub:"Session active", color:"#3b82f6" },
              { label:"AWS ACCOUNT", title:activeAWS?.name||"Not configured", sub:activeAWS?.access ? activeAWS.region : "No credentials", color:"#f59e0b" },
              { label:"BACKEND", title:(creds.backendUrl||BACKEND_URL).replace("http://",""), sub:"Execution target", color:"#10b981" },
              { label:"MODEL", title:(creds.groq?.model||"Not set").split("-").slice(0,3).join("-"), sub:creds.groq?.key?"Connected":"No API key", color:"#8b5cf6" },
            ].map((card,i) => (
              <div key={i} style={{flex:1,background:"#0a0e18",border:"1px solid #1e293b",borderRadius:8,padding:"10px 14px",borderTop:`2px solid ${card.color}`}}>
                <div style={{fontSize:9,color:"#475569",fontFamily:"'JetBrains Mono',monospace",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>{card.label}</div>
                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",fontFamily:"'JetBrains Mono',monospace"}}>{card.title}</div>
                <div style={{fontSize:10,color:"#475569",fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Chat ── */}
          <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>
            {messages.map((msg,i) => (
              <div key={i} className="msg-enter"><MsgBubble role={msg.role} content={msg.content} time={msg.time}/></div>
            ))}
            {isProcessing && <ThinkingDots/>}
            <div ref={chatEndRef}/>
          </div>

          {/* ── Quick cmd pills ── */}
          <div style={{padding:"8px 20px",display:"flex",gap:6,flexWrap:"wrap",borderTop:"1px solid #0f172a",background:"#080c14"}}>
            {mod.quickCmds.map(cmd => (
              <div key={cmd} className="qcmd-pill" onClick={() => setInput(cmd)}
                style={{fontSize:11,padding:"4px 10px",borderRadius:4,cursor:"pointer",background:"#0a0e18",border:"1px solid #1e293b",color:"#475569",fontFamily:"'JetBrains Mono',monospace",transition:"all 0.15s"}}>
                ❯ {cmd}
              </div>
            ))}
          </div>

          {/* ── Input bar ── */}
          <div style={{padding:"10px 20px 12px",background:"#0a0e18",borderTop:"1px solid #1e293b",display:"flex",alignItems:"center",gap:10}}>
            <div style={{fontSize:10,fontFamily:"'JetBrains Mono',monospace",color:hasSSH?"#10b981":"#334155",whiteSpace:"nowrap",padding:"5px 9px",border:`1px solid ${hasSSH?"rgba(16,185,129,0.25)":"#1e293b"}`,borderRadius:5,background:hasSSH?"rgba(16,185,129,0.05)":"transparent"}}>
              {hasSSH ? `🖥 ${activeSSH.host}` : "💻 local"}
            </div>
            <span style={{fontFamily:"'JetBrains Mono',monospace",color:"#3b82f6",fontSize:14}}>❯</span>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder={mod.placeholder}
              style={{flex:1,background:"#0d1220",border:"1px solid #1e293b",color:"#e2e8f0",padding:"9px 14px",borderRadius:7,fontFamily:"'JetBrains Mono',monospace",fontSize:13,outline:"none",transition:"border-color 0.15s"}}
              onFocus={e => e.target.style.borderColor="#3b82f6"} onBlur={e => e.target.style.borderColor="#1e293b"}/>
            <button className="send-btn" onClick={sendMessage} disabled={isProcessing}
              style={{padding:"9px 18px",background:"#3b82f6",color:"#fff",border:"none",borderRadius:7,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,transition:"all 0.15s",letterSpacing:"0.06em",display:"flex",alignItems:"center",gap:6}}>
              RUN <span style={{fontSize:13}}>↗</span>
            </button>
          </div>
        </div>

        {showCredModal && <CredentialsModal creds={creds} onSave={saveCreds} onClose={() => setShowCredModal(false)}/>}
      </div>
    </>
  );
}