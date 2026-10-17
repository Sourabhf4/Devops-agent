import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY  = "devops_agent_creds_v4";

// On EC2 the browser calls /api which nginx proxies to the backend container.
// Falls back to localhost:8000 only for local dev (npm run dev).
const BACKEND_URL  = import.meta.env.VITE_BACKEND_URL || "/api";

// AWS brand palette
const AWS = {
  navy:        "#0f1b2d",
  navyDark:    "#0a1422",
  navyHover:   "#1a2d45",
  orange:      "#ff9900",
  orangeHover: "#ec7211",
  orangeLight: "#fff3e0",
  white:       "#ffffff",
  bg:          "#f2f3f3",       // AWS console grey background
  surface:     "#ffffff",
  border:      "#d5dbdb",
  borderDark:  "#aab7b8",
  text:        "#16191f",
  textMuted:   "#5f6b7a",
  textLight:   "#879596",
  blue:        "#0073bb",
  blueHover:   "#005276",
  blueDark:    "#003f72",
  green:       "#1d8102",
  greenBg:     "#f2f8f0",
  greenBorder: "#c3e6ba",
  red:         "#d13212",
  redBg:       "#fdf3f1",
  redBorder:   "#f5bcbc",
  yellow:      "#8a6116",
  yellowBg:    "#fef9f0",
  yellowBorder:"#f5d898",
  codeBg:      "#1a1a2e",
  codeText:    "#e8eaed",
};

const GROQ_MODELS = [
  { value: "llama-3.3-70b-versatile",      label: "Llama 3.3 · 70B Versatile (Recommended)" },
  { value: "llama3-70b-8192",              label: "Llama 3 · 70B" },
  { value: "llama-3.1-70b-versatile",      label: "Llama 3.1 · 70B Versatile" },
  { value: "llama-3.1-8b-instant",         label: "Llama 3.1 · 8B Instant (Fast)" },
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
  docker:     { icon:"🐳", label:"Docker",     service:"Container Management",  placeholder:"e.g. create an nginx container on port 80",  quickCmds:["List all containers","Show running containers","Pull ubuntu image","Show docker stats"] },
  system:     { icon:"🖥",  label:"System",     service:"Host & Resource Monitor",placeholder:"e.g. show disk usage and memory",            quickCmds:["Check disk space","Show memory usage","List running processes","System uptime"] },
  kubernetes: { icon:"☸",  label:"Kubernetes", service:"Cluster Orchestration", placeholder:"e.g. list all pods in namespace default",    quickCmds:["Get all pods","Get all nodes","List services","Get deployments"] },
  aws:        { icon:"☁",  label:"AWS Cloud",  service:"Cloud Infrastructure",  placeholder:"e.g. list all EC2 instances in us-east-1",   quickCmds:["List S3 buckets","List EC2 instances","List ECS clusters","List Lambda functions"] },
  network:    { icon:"🔗", label:"Network",    service:"Connectivity & DNS",    placeholder:"e.g. check open ports on the server",        quickCmds:["Show open ports","Check DNS for google.com","Test HTTP endpoint","Show interfaces"] },
  logs:       { icon:"📋", label:"Logs",       service:"Log Analysis",          placeholder:"e.g. show last 50 syslog error lines",       quickCmds:["Tail syslog","Show journalctl errors","Docker container logs","Search ERROR in logs"] },
};

const DEFAULT_CREDS = {
  groq:        { key: "", model: "llama-3.3-70b-versatile" },
  awsAccounts: [{ id:"aws-1", name:"Primary Account", access:"", secret:"", region:"us-east-1", bucket:"", active:true }],
  sshHosts:    [{ id:"ssh-1", name:"Production Server", host:"", user:"", key:"", active:true }],
  docker:      { registry:"", user:"", pass:"" },
  k8s:         { config:"", ns:"default" },
  backendUrl:  BACKEND_URL,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const timeStr = () => new Date().toLocaleTimeString("en-GB", { hour12:false });
const uid     = () => Math.random().toString(36).slice(2, 9);

// ─────────────────────────────────────────────────────────────────────────────
// Global CSS  (AWS Console aesthetic)
// ─────────────────────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Amazon+Ember:wght@400;500;700&family=Noto+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

  body {
    background: ${AWS.bg};
    color: ${AWS.text};
    font-family: 'Noto Sans', 'Amazon Ember', -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  ::-webkit-scrollbar        { width:6px; height:6px; }
  ::-webkit-scrollbar-track  { background:${AWS.bg}; }
  ::-webkit-scrollbar-thumb  { background:${AWS.borderDark}; border-radius:3px; }
  ::-webkit-scrollbar-thumb:hover { background:${AWS.textMuted}; }

  /* Animations */
  @keyframes fadeUp   { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spin     { to{transform:rotate(360deg)} }
  @keyframes dotPulse { 0%,100%{opacity:.2} 50%{opacity:1} }
  @keyframes slideDown{ from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }

  .msg-enter { animation: fadeUp .18s ease-out; }

  /* AWS-style button resets */
  button { font-family:inherit; cursor:pointer; }
  input, textarea, select { font-family:inherit; }
  input:focus, textarea:focus, select:focus { outline:none; }

  /* Nav hover */
  .nav-item:hover  { background:${AWS.navyHover} !important; }
  .nav-item.active { background:${AWS.navyHover} !important; border-left:3px solid ${AWS.orange} !important; }

  /* Service card hover */
  .svc-card:hover { border-color:${AWS.blue} !important; box-shadow:0 0 0 2px rgba(0,115,187,.2) !important; }

  /* AWS primary button */
  .btn-primary:hover:not(:disabled) { background:${AWS.orangeHover} !important; }
  .btn-primary:disabled { opacity:.5; cursor:not-allowed; }

  /* AWS link button */
  .btn-link:hover { color:${AWS.blueHover} !important; text-decoration:underline; }

  /* AWS table row hover */
  .tbl-row:hover { background:#f0f3f4 !important; }

  /* Pill hover */
  .pill-btn:hover { background:${AWS.orangeLight} !important; border-color:${AWS.orange} !important; color:${AWS.orange} !important; }

  /* Confirm buttons */
  .confirm-yes:hover { background:#145214 !important; }
  .confirm-no:hover  { background:#a01010 !important; }

  /* Copy / run micro-buttons */
  .micro-btn:hover { background:#e8eaed !important; color:${AWS.blue} !important; }

  /* Dropdown item */
  .dd-item:hover { background:#f0f3f4 !important; }

  /* Input focus */
  .aws-input:focus { border-color:${AWS.blue} !important; box-shadow:0 0 0 2px rgba(0,115,187,.25) !important; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// useCopy hook
// ─────────────────────────────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = useCallback((text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);
  return { copied, copy };
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS-style form components
// ─────────────────────────────────────────────────────────────────────────────
const awsInputBase = {
  background: AWS.white,
  border: `1px solid ${AWS.borderDark}`,
  color: AWS.text,
  padding: "6px 10px",
  borderRadius: 2,
  fontSize: 14,
  width: "100%",
  transition: "border-color .15s, box-shadow .15s",
};

function FormField({ label, type="text", placeholder, value, onChange, hint, required }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:13, fontWeight:600, color:AWS.text }}>
        {label}{required && <span style={{ color:AWS.red, marginLeft:3 }}>*</span>}
      </label>
      <input type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)} autoComplete="off"
        className="aws-input"
        style={awsInputBase}
      />
      {hint && <span style={{ fontSize:12, color:AWS.textMuted }}>{hint}</span>}
    </div>
  );
}

function FormSelect({ label, value, onChange, options, required }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:13, fontWeight:600, color:AWS.text }}>
        {label}{required && <span style={{ color:AWS.red, marginLeft:3 }}>*</span>}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="aws-input"
        style={{ ...awsInputBase, cursor:"pointer" }}>
        {options.map(o => <option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
      </select>
    </div>
  );
}

function FormTextarea({ label, placeholder, value, onChange, rows=4, hint }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <label style={{ fontSize:13, fontWeight:600, color:AWS.text }}>{label}</label>
      <textarea placeholder={placeholder} value={value} rows={rows}
        onChange={e => onChange(e.target.value)}
        className="aws-input"
        style={{ ...awsInputBase, resize:"vertical", lineHeight:1.5 }}
      />
      {hint && <span style={{ fontSize:12, color:AWS.textMuted }}>{hint}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS Alert banner
// ─────────────────────────────────────────────────────────────────────────────
function Alert({ type="info", title, children }) {
  const styles = {
    info:    { bg:AWS.bg,        border:AWS.borderDark, icon:"ℹ",  iconColor:AWS.blue,  titleColor:AWS.blueDark },
    success: { bg:AWS.greenBg,   border:AWS.greenBorder,icon:"✓",  iconColor:AWS.green, titleColor:AWS.green },
    warning: { bg:AWS.yellowBg,  border:AWS.yellowBorder,icon:"⚠", iconColor:AWS.yellow,titleColor:AWS.yellow },
    error:   { bg:AWS.redBg,     border:AWS.redBorder,  icon:"✕",  iconColor:AWS.red,   titleColor:AWS.red },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{ background:s.bg, border:`1px solid ${s.border}`, borderLeft:`4px solid ${s.iconColor}`,
      borderRadius:4, padding:"10px 14px", display:"flex", gap:10, alignItems:"flex-start" }}>
      <span style={{ color:s.iconColor, fontSize:16, flexShrink:0, fontWeight:700, lineHeight:1.4 }}>{s.icon}</span>
      <div style={{ fontSize:13, lineHeight:1.6, color:AWS.text }}>
        {title && <div style={{ fontWeight:700, color:s.titleColor, marginBottom:2 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Code block
// ─────────────────────────────────────────────────────────────────────────────
function CodeBlock({ content, id, onRunCommand }) {
  const { copied, copy } = useCopy();
  return (
    <div style={{ marginTop:10, borderRadius:4, overflow:"hidden",
      border:`1px solid ${AWS.borderDark}`, fontFamily:"'JetBrains Mono',monospace" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        background:"#2d3748", padding:"5px 12px" }}>
        <span style={{ fontSize:11, color:"#a0aec0", letterSpacing:".06em" }}>shell output</span>
        <div style={{ display:"flex", gap:6 }}>
          {onRunCommand && (
            <button className="micro-btn" onClick={() => onRunCommand(content)}
              style={{ fontSize:11, padding:"2px 8px", borderRadius:2,
                border:`1px solid #4a5568`, background:"transparent",
                color:"#a0aec0", cursor:"pointer", transition:"all .15s" }}>
              ▶ Run
            </button>
          )}
          <button className="micro-btn" onClick={() => copy(content, id)}
            style={{ fontSize:11, padding:"2px 8px", borderRadius:2,
              border:`1px solid #4a5568`, background:"transparent",
              color:"#a0aec0", cursor:"pointer", transition:"all .15s" }}>
            {copied === id ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre style={{ background:AWS.codeBg, padding:"12px 14px", overflowX:"auto",
        color:"#a8d8a8", fontSize:12, lineHeight:1.7,
        whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0 }}>
        {content}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline text formatter
// ─────────────────────────────────────────────────────────────────────────────
function InlineText({ text }) {
  const html = text
    .replace(/`([^`]+)`/g, `<code style="background:#f0f3f4;padding:1px 5px;border-radius:2px;font-family:'JetBrains Mono',monospace;font-size:12px;color:${AWS.blueDark};border:1px solid ${AWS.border}">$1</code>`)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message content renderer
// ─────────────────────────────────────────────────────────────────────────────
function MessageContent({ content, onRunCommand }) {
  const parts = useMemo(() => {
    const result = [];
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let last = 0, m;
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) result.push({ type:"text", content:content.slice(last, m.index) });
      result.push({ type:"code", content:m[2].trim(), id:uid() });
      last = m.index + m[0].length;
    }
    if (last < content.length) result.push({ type:"text", content:content.slice(last) });
    return result;
  }, [content]);

  return (
    <div style={{ fontSize:14, lineHeight:1.7, color:AWS.text }}>
      {parts.map((p, i) =>
        p.type === "code" ? (
          <CodeBlock key={i} content={p.content} id={p.id} onRunCommand={onRunCommand} />
        ) : (
          <p key={i} style={{ whiteSpace:"pre-wrap", marginBottom: i < parts.length-1 ? 8 : 0 }}>
            {p.content.split("\n").map((line, li, arr) => (
              <span key={li}>
                <InlineText text={line} />
                {li < arr.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm execution panel (AWS action confirmation style)
// ─────────────────────────────────────────────────────────────────────────────
function ConfirmPanel({ command, onConfirm, onCancel }) {
  const { copied, copy } = useCopy();
  return (
    <div style={{ marginTop:12, border:`1px solid ${AWS.yellowBorder}`,
      borderRadius:4, background:AWS.yellowBg, overflow:"hidden" }}>
      <div style={{ padding:"10px 14px", background:"#fdf6e3",
        borderBottom:`1px solid ${AWS.yellowBorder}`, display:"flex",
        alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ color:AWS.yellow, fontSize:16 }}>⚠</span>
          <span style={{ fontWeight:700, color:AWS.yellow, fontSize:13 }}>
            Confirm command execution
          </span>
        </div>
        <button className="micro-btn" onClick={() => copy(command, "confirm-cmd")}
          style={{ fontSize:12, padding:"3px 10px", borderRadius:2,
            border:`1px solid ${AWS.border}`, background:AWS.white,
            color:AWS.textMuted, cursor:"pointer" }}>
          {copied === "confirm-cmd" ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div style={{ padding:"10px 14px" }}>
        <p style={{ fontSize:13, color:AWS.textMuted, marginBottom:8 }}>
          The following command will be executed on your target:
        </p>
        <pre style={{ background:AWS.codeBg, border:`1px solid ${AWS.borderDark}`,
          borderRadius:3, padding:"10px 12px", fontFamily:"'JetBrains Mono',monospace",
          fontSize:12, color:"#ffd580", whiteSpace:"pre-wrap", wordBreak:"break-all",
          marginBottom:12 }}>
          {command}
        </pre>
        <div style={{ display:"flex", gap:8 }}>
          <button className="confirm-yes" onClick={onConfirm}
            style={{ padding:"7px 18px", background:AWS.green, color:AWS.white,
              border:"none", borderRadius:2, fontSize:13, fontWeight:600,
              cursor:"pointer", transition:"background .15s" }}>
            Execute
          </button>
          <button className="confirm-no" onClick={onCancel}
            style={{ padding:"7px 18px", background:AWS.red, color:AWS.white,
              border:"none", borderRadius:2, fontSize:13, fontWeight:600,
              cursor:"pointer", transition:"background .15s" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat message
// ─────────────────────────────────────────────────────────────────────────────
function ChatMessage({ role, content, time, type, command, onConfirm, onCancel, onRunCommand }) {
  const { copied, copy } = useCopy();
  const isAI     = role === "ai";
  const isError  = type === "error"  || type === "blocked";
  const isConfirm= type === "confirm";
  const isResult = type === "result";
  const isUser   = !isAI;

  const borderColor = isError ? AWS.red : isConfirm ? AWS.yellow : isResult ? AWS.green : AWS.borderDark;

  if (isUser) {
    return (
      <div className="msg-enter" style={{ display:"flex", justifyContent:"flex-end", marginBottom:2 }}>
        <div style={{ maxWidth:"75%", background:AWS.navy, color:AWS.white,
          borderRadius:4, padding:"10px 14px", fontSize:14, lineHeight:1.65,
          boxShadow:"0 1px 3px rgba(0,0,0,.15)" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginBottom:4,
            fontFamily:"'JetBrains Mono',monospace" }}>You · {time}</div>
          <div style={{ whiteSpace:"pre-wrap" }}>{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-enter" style={{ display:"flex", gap:10, marginBottom:2 }}>
      {/* Avatar */}
      <div style={{ flexShrink:0, width:32, height:32, borderRadius:"50%",
        background: isError ? AWS.red : AWS.navy,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:14, color:AWS.white, fontWeight:700, marginTop:2 }}>
        {isError ? "!" : "A"}
      </div>

      <div style={{ flex:1, minWidth:0 }}>
        {/* Message header */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
          <span style={{ fontSize:13, fontWeight:700, color:AWS.navy }}>DevOps Agent</span>
          {/* Badge */}
          {type && type !== "answer" && (
            <span style={{ fontSize:11, padding:"1px 7px", borderRadius:10, fontWeight:600,
              background: isError ? AWS.redBg : isConfirm ? AWS.yellowBg : isResult ? AWS.greenBg : "#e8f4fd",
              color: isError ? AWS.red : isConfirm ? AWS.yellow : isResult ? AWS.green : AWS.blue,
              border: `1px solid ${isError ? AWS.redBorder : isConfirm ? AWS.yellowBorder : isResult ? AWS.greenBorder : "#b3d7f0"}` }}>
              {isError ? "Error" : isConfirm ? "Confirmation required" : isResult ? "Executed" : type}
            </span>
          )}
          <span style={{ fontSize:11, color:AWS.textLight, marginLeft:"auto" }}>{time}</span>
          <button className="micro-btn" onClick={() => copy(content, `msg-${time}`)}
            title="Copy response"
            style={{ fontSize:11, padding:"2px 8px", borderRadius:2,
              border:`1px solid ${AWS.border}`, background:"transparent",
              color:AWS.textMuted, cursor:"pointer", transition:"all .15s" }}>
            {copied === `msg-${time}` ? "✓" : "Copy"}
          </button>
        </div>

        {/* Bubble */}
        <div style={{ background:AWS.surface, border:`1px solid ${borderColor}`,
          borderRadius:4, padding:"12px 14px",
          boxShadow: isError || isConfirm || isResult
            ? `0 0 0 1px ${borderColor}22`
            : "0 1px 3px rgba(0,0,0,.08)" }}>
          <MessageContent content={content} onRunCommand={onRunCommand} />
          {isConfirm && command && (
            <ConfirmPanel command={command} onConfirm={onConfirm} onCancel={onCancel} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thinking dots
// ─────────────────────────────────────────────────────────────────────────────
function Thinking() {
  return (
    <div style={{ display:"flex", gap:10, marginBottom:2, alignItems:"center" }}>
      <div style={{ width:32, height:32, borderRadius:"50%", background:AWS.navy,
        display:"flex", alignItems:"center", justifyContent:"center",
        color:AWS.white, fontSize:14, fontWeight:700, flexShrink:0 }}>A</div>
      <div style={{ background:AWS.surface, border:`1px solid ${AWS.border}`,
        borderRadius:4, padding:"10px 16px", display:"flex", alignItems:"center",
        gap:10, boxShadow:"0 1px 3px rgba(0,0,0,.08)" }}>
        <div style={{ display:"flex", gap:5 }}>
          {[0,.2,.4].map((d,i) =>
            <span key={i} style={{ width:7, height:7, borderRadius:"50%", background:AWS.orange,
              display:"inline-block", animation:`dotPulse 1.2s ${d}s infinite` }} />
          )}
        </div>
        <span style={{ fontSize:13, color:AWS.textMuted }}>DevOps Agent is thinking…</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Command History drawer (bottom sheet)
// ─────────────────────────────────────────────────────────────────────────────
function HistoryDrawer({ history, onSelect, onClose }) {
  return (
    <div onClick={e => e.target===e.currentTarget && onClose()}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:200,
        display:"flex", alignItems:"flex-end" }}>
      <div style={{ width:"100%", maxWidth:800, margin:"0 auto",
        background:AWS.surface, border:`1px solid ${AWS.border}`,
        borderRadius:"8px 8px 0 0", maxHeight:"60vh",
        display:"flex", flexDirection:"column",
        boxShadow:"0 -4px 24px rgba(0,0,0,.2)", animation:"slideDown .2s ease-out" }}>
        <div style={{ padding:"14px 20px", borderBottom:`1px solid ${AWS.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:AWS.bg }}>
          <span style={{ fontSize:14, fontWeight:700, color:AWS.navy }}>Command History</span>
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:AWS.textMuted,
              cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>
        </div>
        <div style={{ overflowY:"auto", flex:1 }}>
          {history.length === 0 ? (
            <div style={{ padding:"32px", textAlign:"center", color:AWS.textMuted, fontSize:14 }}>
              No commands executed in this session.
            </div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:AWS.bg, borderBottom:`1px solid ${AWS.border}` }}>
                  {["Status","Time","Command"].map(h => (
                    <th key={h} style={{ padding:"8px 16px", textAlign:"left", fontSize:12,
                      fontWeight:700, color:AWS.textMuted, textTransform:"uppercase",
                      letterSpacing:".06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((item, i) => (
                  <tr key={i} className="tbl-row"
                    style={{ borderBottom:`1px solid ${AWS.border}`, cursor:"pointer" }}
                    onClick={() => { onSelect(item.cmd); onClose(); }}>
                    <td style={{ padding:"10px 16px" }}>
                      <span style={{ fontSize:12, fontWeight:600, padding:"2px 8px", borderRadius:10,
                        background: item.exitCode===0 ? AWS.greenBg : AWS.redBg,
                        color: item.exitCode===0 ? AWS.green : AWS.red,
                        border: `1px solid ${item.exitCode===0 ? AWS.greenBorder : AWS.redBorder}` }}>
                        {item.exitCode===0 ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td style={{ padding:"10px 16px", fontSize:12,
                      fontFamily:"'JetBrains Mono',monospace", color:AWS.textMuted }}>
                      {item.time}
                    </td>
                    <td style={{ padding:"10px 16px", fontSize:12,
                      fontFamily:"'JetBrains Mono',monospace", color:AWS.blueDark }}>
                      {item.cmd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SSH Host form card
// ─────────────────────────────────────────────────────────────────────────────
function SSHHostCard({ host, onUpdate, onRemove, isOnly }) {
  const [open, setOpen] = useState(!host.host);
  const set = f => v => onUpdate({ ...host, [f]:v });
  const ok = !!(host.host && host.user);
  return (
    <div style={{ border:`1px solid ${AWS.border}`, borderRadius:4, background:AWS.surface, overflow:"hidden" }}>
      <div onClick={() => setOpen(o=>!o)}
        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
          cursor:"pointer", background:AWS.bg, borderBottom: open ? `1px solid ${AWS.border}` : "none" }}>
        <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
          background: ok ? AWS.green : AWS.borderDark }} />
        <span style={{ fontSize:13, fontWeight:600, flex:1, color:AWS.text }}>
          {host.name || "Unnamed Host"}
        </span>
        {ok && <span style={{ fontSize:12, color:AWS.textMuted, fontFamily:"'JetBrains Mono',monospace" }}>
          {host.user}@{host.host}
        </span>}
        <span style={{ fontSize:11, color:AWS.textMuted }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
          <FormField label="Display name" placeholder="Production Server" value={host.name} onChange={set("name")} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <FormField label="Host / IP address" placeholder="ec2-xx-xx.compute.amazonaws.com" value={host.host} onChange={set("host")} />
            <FormField label="Username" placeholder="ubuntu" value={host.user} onChange={set("user")} />
          </div>
          <FormTextarea label="SSH private key (PEM)" value={host.key} onChange={set("key")} rows={3}
            placeholder={"-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
            hint="Leave empty to use SSH agent or ~/.ssh/id_rsa" />
          {!isOnly && (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button onClick={() => onRemove(host.id)}
                style={{ padding:"5px 14px", background:"transparent", color:AWS.red,
                  border:`1px solid ${AWS.redBorder}`, borderRadius:2, fontSize:13, cursor:"pointer" }}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS Account form card
// ─────────────────────────────────────────────────────────────────────────────
function AWSAccountCard({ account, onUpdate, onRemove, isOnly }) {
  const [open, setOpen] = useState(!account.access);
  const set = f => v => onUpdate({ ...account, [f]:v });
  const ok = !!(account.access && account.secret);
  return (
    <div style={{ border:`1px solid ${AWS.border}`, borderRadius:4, background:AWS.surface, overflow:"hidden" }}>
      <div onClick={() => setOpen(o=>!o)}
        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
          cursor:"pointer", background:AWS.bg, borderBottom: open ? `1px solid ${AWS.border}` : "none" }}>
        <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
          background: ok ? AWS.green : AWS.borderDark }} />
        <span style={{ fontSize:13, fontWeight:600, flex:1, color:AWS.text }}>
          {account.name || "Unnamed Account"}
        </span>
        {account.region && <span style={{ fontSize:12, color:AWS.textMuted,
          fontFamily:"'JetBrains Mono',monospace" }}>{account.region}</span>}
        <span style={{ fontSize:11, color:AWS.textMuted }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
          <FormField label="Account name" placeholder="Production / Staging" value={account.name} onChange={set("name")} />
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <FormField label="Access key ID" type="password" placeholder="AKIAIOSFODNN7EXAMPLE" value={account.access} onChange={set("access")} />
            <FormField label="Secret access key" type="password" placeholder="wJalrXUtn..." value={account.secret} onChange={set("secret")} />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <FormSelect label="Region" value={account.region} onChange={set("region")} options={AWS_REGIONS} />
            <FormField label="S3 bucket (optional)" placeholder="my-bucket-name" value={account.bucket||""} onChange={set("bucket")} />
          </div>
          {!isOnly && (
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button onClick={() => onRemove(account.id)}
                style={{ padding:"5px 14px", background:"transparent", color:AWS.red,
                  border:`1px solid ${AWS.redBorder}`, borderRadius:2, fontSize:13, cursor:"pointer" }}>
                Remove account
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials / Settings Modal (AWS "Create resource" panel style)
// ─────────────────────────────────────────────────────────────────────────────
function SettingsModal({ creds, onSave, onClose }) {
  const [local, setLocal] = useState(creds);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("groq");

  const save = () => { onSave(local); setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const updateSSH = u => setLocal(p => ({ ...p, sshHosts:p.sshHosts.map(h=>h.id===u.id?u:h) }));
  const removeSSH = id => setLocal(p => ({ ...p, sshHosts:p.sshHosts.filter(h=>h.id!==id) }));
  const addSSH    = () => setLocal(p => ({ ...p, sshHosts:[...p.sshHosts,{ id:uid(), name:`Host ${p.sshHosts.length+1}`, host:"",user:"",key:"",active:false }] }));

  const updateAWS = u => setLocal(p => ({ ...p, awsAccounts:p.awsAccounts.map(a=>a.id===u.id?u:a) }));
  const removeAWS = id => setLocal(p => ({ ...p, awsAccounts:p.awsAccounts.filter(a=>a.id!==id) }));
  const addAWS    = () => setLocal(p => ({ ...p, awsAccounts:[...p.awsAccounts,{ id:uid(), name:`Account ${p.awsAccounts.length+1}`, access:"",secret:"",region:"us-east-1",bucket:"",active:false }] }));

  const tabs = [
    { key:"groq",    label:"LLM / Groq" },
    { key:"ssh",     label:`SSH Hosts (${local.sshHosts.length})` },
    { key:"aws",     label:`AWS Accounts (${local.awsAccounts.length})` },
    { key:"docker",  label:"Docker Registry" },
    { key:"k8s",     label:"Kubernetes" },
    { key:"backend", label:"Backend" },
  ];

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()}
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.5)", zIndex:300,
        display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:AWS.surface, border:`1px solid ${AWS.border}`,
        borderRadius:4, width:620, maxHeight:"90vh",
        display:"flex", flexDirection:"column",
        boxShadow:"0 8px 32px rgba(0,0,0,.25)", animation:"fadeUp .2s ease-out" }}>

        {/* Modal header — AWS panel title style */}
        <div style={{ padding:"14px 20px", borderBottom:`1px solid ${AWS.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:AWS.navy, borderRadius:"4px 4px 0 0" }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:AWS.white }}>Settings</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,.65)", marginTop:1 }}>
              Credentials and configuration
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:"none", border:"1px solid rgba(255,255,255,.3)",
              color:"rgba(255,255,255,.8)", cursor:"pointer", fontSize:18,
              width:28, height:28, borderRadius:2, display:"flex",
              alignItems:"center", justifyContent:"center", lineHeight:1 }}>×</button>
        </div>

        {/* Tabs — AWS horizontal tab nav */}
        <div style={{ display:"flex", borderBottom:`1px solid ${AWS.border}`,
          background:AWS.bg, flexShrink:0, overflowX:"auto" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={()=>setTab(t.key)}
              style={{ padding:"10px 16px", border:"none", cursor:"pointer",
                fontSize:13, fontWeight:600, whiteSpace:"nowrap",
                background: tab===t.key ? AWS.surface : "transparent",
                color: tab===t.key ? AWS.orange : AWS.textMuted,
                borderBottom: tab===t.key ? `2px solid ${AWS.orange}` : "2px solid transparent",
                transition:"all .15s" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ overflowY:"auto", padding:20, flex:1, display:"flex",
          flexDirection:"column", gap:16 }}>

          {tab === "groq" && <>
            <Alert type="info" title="Groq API key required">
              Get your free key at <a href="https://console.groq.com" target="_blank" rel="noreferrer"
                style={{ color:AWS.blue }}>console.groq.com</a>. 
              Keys are stored in your browser only and never sent to any third-party server.
            </Alert>
            <FormField label="Groq API key" type="password" placeholder="gsk_..." required
              value={local.groq.key} onChange={v=>setLocal(p=>({...p,groq:{...p.groq,key:v}}))} />
            <FormSelect label="Model" value={local.groq.model}
              onChange={v=>setLocal(p=>({...p,groq:{...p.groq,model:v}}))} options={GROQ_MODELS} />
          </>}

          {tab === "ssh" && <>
            <Alert type="info">
              SSH hosts are the servers where commands will run. Select the active target from the console header.
            </Alert>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {local.sshHosts.map(h =>
                <SSHHostCard key={h.id} host={h} onUpdate={updateSSH} onRemove={removeSSH} isOnly={local.sshHosts.length===1} />
              )}
            </div>
            <button onClick={addSSH}
              style={{ padding:"7px 14px", border:`1px dashed ${AWS.borderDark}`,
                borderRadius:2, background:"transparent", color:AWS.textMuted,
                fontSize:13, cursor:"pointer", display:"flex",
                alignItems:"center", justifyContent:"center", gap:6 }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=AWS.blue;e.currentTarget.style.color=AWS.blue;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=AWS.borderDark;e.currentTarget.style.color=AWS.textMuted;}}>
              + Add SSH host
            </button>
          </>}

          {tab === "aws" && <>
            <Alert type="info">
              Manage multiple AWS accounts. Switch between them in the console header.
            </Alert>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {local.awsAccounts.map(a =>
                <AWSAccountCard key={a.id} account={a} onUpdate={updateAWS} onRemove={removeAWS} isOnly={local.awsAccounts.length===1} />
              )}
            </div>
            <button onClick={addAWS}
              style={{ padding:"7px 14px", border:`1px dashed ${AWS.borderDark}`,
                borderRadius:2, background:"transparent", color:AWS.textMuted,
                fontSize:13, cursor:"pointer" }}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=AWS.orange;e.currentTarget.style.color=AWS.orange;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=AWS.borderDark;e.currentTarget.style.color=AWS.textMuted;}}>
              + Add AWS account
            </button>
          </>}

          {tab === "docker" && <>
            <FormField label="Registry URL" placeholder="registry.hub.docker.com" value={local.docker.registry} onChange={v=>setLocal(p=>({...p,docker:{...p.docker,registry:v}}))} />
            <FormField label="Username" placeholder="username" value={local.docker.user} onChange={v=>setLocal(p=>({...p,docker:{...p.docker,user:v}}))} />
            <FormField label="Password / Access token" type="password" placeholder="••••••••" value={local.docker.pass} onChange={v=>setLocal(p=>({...p,docker:{...p.docker,pass:v}}))} />
          </>}

          {tab === "k8s" && <>
            <FormTextarea label="kubeconfig (paste YAML content)" value={local.k8s.config}
              onChange={v=>setLocal(p=>({...p,k8s:{...p.k8s,config:v}}))}
              placeholder={"apiVersion: v1\nclusters:\n  - name: my-cluster..."} rows={5} />
            <FormField label="Namespace" placeholder="default" value={local.k8s.ns}
              onChange={v=>setLocal(p=>({...p,k8s:{...p.k8s,ns:v}}))} />
          </>}

          {tab === "backend" && <>
            <Alert type="info">
              When running on EC2 via Docker Compose, keep this as <strong>/api</strong> — nginx
              handles the proxy internally. Only change it if you are running the backend on a
              different host.
            </Alert>
            <FormField label="Backend URL" placeholder="/api"
              value={local.backendUrl||BACKEND_URL} onChange={v=>setLocal(p=>({...p,backendUrl:v}))}
              hint="Default: /api (proxied by nginx). For local dev only: http://localhost:8000" />
          </>}

        </div>

        {/* Footer */}
        <div style={{ padding:"12px 20px", borderTop:`1px solid ${AWS.border}`,
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:AWS.bg, flexShrink:0, borderRadius:"0 0 4px 4px" }}>
          <span style={{ fontSize:12, color:AWS.green, opacity:saved?1:0, transition:"opacity .3s" }}>
            ✓ Settings saved
          </span>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onClose}
              style={{ padding:"7px 16px", background:AWS.surface, color:AWS.text,
                border:`1px solid ${AWS.borderDark}`, borderRadius:2,
                fontSize:13, fontWeight:600, cursor:"pointer" }}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}
              style={{ padding:"7px 20px", background:AWS.orange, color:AWS.white,
                border:"none", borderRadius:2, fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Region / Account dropdown  (AWS header style)
// ─────────────────────────────────────────────────────────────────────────────
function NavDropdown({ label, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ padding:"6px 10px", background:"transparent",
          border:"none", color:"rgba(255,255,255,.85)",
          cursor:"pointer", display:"flex", alignItems:"center",
          gap:6, fontSize:13, fontWeight:500, borderRadius:2,
          transition:"background .15s" }}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.1)"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        {label}
        <span style={{ fontSize:9, opacity:.7 }}>▼</span>
      </button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", right:0, minWidth:230,
          background:AWS.surface, border:`1px solid ${AWS.border}`,
          borderRadius:4, boxShadow:"0 4px 20px rgba(0,0,0,.2)",
          zIndex:500, overflow:"hidden", animation:"slideDown .15s ease-out" }}>
          {options.map((o,i) => (
            <div key={i} className="dd-item"
              onClick={()=>{ onSelect(o); setOpen(false); }}
              style={{ padding:"9px 14px", fontSize:13, color:AWS.text,
                cursor:"pointer", borderBottom: i<options.length-1 ? `1px solid ${AWS.bg}` : "none",
                display:"flex", alignItems:"center", gap:8,
                transition:"background .1s" }}>
              {o.icon && <span>{o.icon}</span>}
              <span style={{ flex:1 }}>{o.label||o.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function DevOpsAgent() {
  const [mod,          setMod]          = useState("docker");
  const [creds,        setCreds]        = useState(DEFAULT_CREDS);
  const [messages,     setMessages]     = useState([]);
  const [sessionId,    setSessionId]    = useState(null);
  const [input,        setInput]        = useState("");
  const [busy,         setBusy]         = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);
  const [cmdHistory,   setCmdHistory]   = useState([]);
  const [activeSSHId,  setActiveSSHId]  = useState(null);
  const [activeAWSId,  setActiveAWSId]  = useState(null);
  const [inputHistory, setInputHistory] = useState([]);
  const [histIdx,      setHistIdx]      = useState(-1);
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);

  // ── Load localStorage ───────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setCreds(prev => ({ ...prev, ...p }));
        if (p.sshHosts?.length)    setActiveSSHId(p.sshHosts[0].id);
        if (p.awsAccounts?.length) setActiveAWSId(p.awsAccounts[0].id);
      } else {
        setActiveSSHId(DEFAULT_CREDS.sshHosts[0].id);
        setActiveAWSId(DEFAULT_CREDS.awsAccounts[0].id);
      }
    } catch {}
    setMessages([{
      role:"ai", type:"answer", time:timeStr(),
      content:"**Welcome to DevOps Agent**\n\nI'm your AI-powered infrastructure assistant. I maintain context throughout our conversation — you won't need to repeat information.\n\nTo get started:\n1. Open **Settings** (top right) and add your Groq API key\n2. Configure an SSH host or AWS account\n3. Select a service from the left panel and ask me anything",
    }]);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, busy]);

  useEffect(() => {
    if (!creds.sshHosts.find(h=>h.id===activeSSHId))  setActiveSSHId(creds.sshHosts[0]?.id||null);
    if (!creds.awsAccounts.find(a=>a.id===activeAWSId)) setActiveAWSId(creds.awsAccounts[0]?.id||null);
  }, [creds]);

  const saveCreds = useCallback(c => {
    setCreds(c);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {}
  }, []);

  const activeSSH = creds.sshHosts.find(h=>h.id===activeSSHId)    || creds.sshHosts[0];
  const activeAWS = creds.awsAccounts.find(a=>a.id===activeAWSId) || creds.awsAccounts[0];
  const backendUrl = creds.backendUrl || BACKEND_URL;
  const hasSSH = !!(activeSSH?.host && activeSSH?.user);
  const hasAWS = !!(activeAWS?.access && activeAWS?.secret);

  const buildConfig = useCallback(() => ({
    groq_key:   creds.groq?.key || "",
    groq_model: creds.groq?.model || "llama-3.3-70b-versatile",
    module: mod,
    aws:    { access:activeAWS?.access||"", secret:activeAWS?.secret||"", region:activeAWS?.region||"us-east-1", bucket:activeAWS?.bucket||"" },
    target: { host:activeSSH?.host||"", user:activeSSH?.user||"", key:activeSSH?.key||"" },
  }), [creds, mod, activeSSH, activeAWS]);

  // ── Switch module ───────────────────────────────────────────────────────────
  const switchModule = useCallback(m => {
    if (m === mod) return;
    setMod(m);
    setSessionId(null);
    setCmdHistory([]);
    if (sessionId) fetch(`${backendUrl}/session/${sessionId}`, { method:"DELETE" }).catch(()=>{});
    setMessages([{
      role:"ai", type:"answer", time:timeStr(),
      content:`Switched to **${MODULES[m].label}** — ${MODULES[m].service}.\n\nNew session started.`,
    }]);
  }, [mod, sessionId, backendUrl]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (override) => {
    const msg = (override ?? input).trim();
    if (!msg || busy) return;
    setInput(""); setHistIdx(-1);
    setInputHistory(prev => msg===prev[0] ? prev : [msg,...prev.slice(0,49)]);

    if (!creds.groq?.key) {
      setMessages(prev=>[...prev,{
        role:"ai", type:"error", time:timeStr(),
        content:"**No API key configured.**\n\nPlease open Settings (top right) and add your Groq API key to continue.",
      }]);
      return;
    }

    setMessages(prev=>[...prev,{ role:"user", type:"user", content:msg, time:timeStr() }]);
    setBusy(true);

    try {
      const res = await fetch(`${backendUrl}/agent`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ message:msg, session_id:sessionId, config:buildConfig() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.detail || `Backend error ${res.status}`);
      }
      const data = await res.json();
      if (data.session_id && !sessionId) setSessionId(data.session_id);

      if (data.type==="result" && data.command) {
        setCmdHistory(prev=>[...prev,{ cmd:data.command, time:timeStr(), exitCode:data.exit_code??0 }]);
      }

      let content = data.output || "";
      if (data.type==="result" && data.command && data.output) {
        content = `**Executed:** \`${data.command}\`\n\n\`\`\`\n${data.output}\n\`\`\``;
      }

      setMessages(prev=>[...prev,{
        role:"ai", type:data.type||"answer",
        content, command:data.command, time:timeStr(),
      }]);
    } catch (err) {
      setMessages(prev=>[...prev,{
        role:"ai", type:"error", time:timeStr(),
        content:`**Connection failed:** ${err.message}\n\nVerify the backend is running at \`${backendUrl}\`.`,
      }]);
    }
    setBusy(false);
    inputRef.current?.focus();
  }, [input, busy, creds, sessionId, backendUrl, buildConfig]);

  // ── Confirm YES / NO ────────────────────────────────────────────────────────
  const handleConfirm = useCallback((answer, idx) => {
    setMessages(prev=>prev.map((m,i)=>
      i===idx ? { ...m, confirmed:true, type:answer==="YES"?"answer":"cancelled" } : m
    ));
    sendMessage(answer);
  }, [sendMessage]);

  // ── Keyboard nav ────────────────────────────────────────────────────────────
  const handleKey = useCallback(e => {
    if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); return; }
    if (e.key==="ArrowUp") {
      e.preventDefault();
      setHistIdx(i=>{ const n=Math.min(i+1,inputHistory.length-1); setInput(inputHistory[n]||""); return n; });
    }
    if (e.key==="ArrowDown") {
      e.preventDefault();
      setHistIdx(i=>{ const n=Math.max(i-1,-1); setInput(n===-1?"":inputHistory[n]||""); return n; });
    }
  }, [sendMessage, inputHistory]);

  // ── New session ─────────────────────────────────────────────────────────────
  const newSession = useCallback(() => {
    if (sessionId) fetch(`${backendUrl}/session/${sessionId}`, { method:"DELETE" }).catch(()=>{});
    setSessionId(null); setCmdHistory([]);
    setMessages([{ role:"ai", type:"answer", time:timeStr(), content:"New session started. Context has been cleared." }]);
  }, [sessionId, backendUrl]);

  const modInfo = MODULES[mod];
  const sshOptions = creds.sshHosts.map(h=>({ value:h.id, icon:"🖥", label:h.host?`${h.name} (${h.user}@${h.host})`:`${h.name} — not configured` }));
  const awsOptions = creds.awsAccounts.map(a=>({ value:a.id, icon:"☁", label:a.access?`${a.name} · ${a.region}`:`${a.name} — not configured` }));

  return (
    <>
      <style>{GLOBAL_CSS}</style>

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden",
        background:AWS.bg, color:AWS.text }}>

        {/* ══════════════════════════════════════════════════════════════
            TOP NAV BAR  — AWS Console header
        ══════════════════════════════════════════════════════════════ */}
        <div style={{ background:AWS.navy, height:48, display:"flex", alignItems:"center",
          padding:"0 16px", gap:4, flexShrink:0, boxShadow:"0 1px 0 rgba(255,255,255,.08)",
          zIndex:100, position:"relative" }}>

          {/* Logo / Brand */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:16,
            paddingRight:16, borderRight:"1px solid rgba(255,255,255,.15)" }}>
            {/* AWS-style square logo */}
            <div style={{ width:28, height:28, background:AWS.orange, borderRadius:3,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.072.056.144.056.208 0 .09-.056.184-.176.28l-.583.384c-.08.056-.16.084-.232.084-.09 0-.18-.044-.27-.128a2.788 2.788 0 0 1-.323-.42 6.944 6.944 0 0 1-.28-.528c-.703.828-1.584 1.242-2.64 1.242-.755 0-1.358-.216-1.8-.647-.442-.43-.667-1.003-.667-1.717 0-.76.27-1.375.816-1.838.545-.463 1.27-.695 2.187-.695.304 0 .616.024.944.072.328.048.664.12 1.016.208v-.647c0-.672-.14-1.143-.416-1.42-.28-.278-.754-.414-1.43-.414-.307 0-.623.04-.947.116a6.918 6.918 0 0 0-.946.308 2.508 2.508 0 0 1-.308.116.535.535 0 0 1-.14.024c-.123 0-.184-.088-.184-.268V5.46c0-.14.02-.244.06-.308.04-.064.116-.128.228-.192.307-.16.675-.294 1.107-.402A5.46 5.46 0 0 1 4.17 4.4c1.07 0 1.854.243 2.358.73.5.486.754 1.224.754 2.213v2.693zm-3.647 1.368c.296 0 .6-.056.924-.168.323-.112.61-.315.854-.595.144-.172.252-.36.308-.576.056-.216.088-.472.088-.772V9.7a7.416 7.416 0 0 0-.82-.14 6.72 6.72 0 0 0-.836-.052c-.596 0-1.03.116-1.328.356-.296.24-.443.575-.443 1.007 0 .408.104.712.316.916.208.2.5.3.937.3v.003zm7.178.987c-.155 0-.26-.028-.328-.084-.068-.052-.128-.172-.18-.336l-2.012-6.614a1.52 1.52 0 0 1-.08-.344c0-.136.068-.208.204-.208h.832c.16 0 .27.028.334.084.068.052.124.172.176.336l1.44 5.68 1.336-5.68c.044-.168.1-.284.168-.336.068-.052.184-.084.344-.084h.68c.16 0 .27.028.344.084.068.052.128.172.172.336l1.352 5.752 1.48-5.752c.052-.168.112-.284.176-.336.064-.052.176-.084.332-.084h.79c.136 0 .208.068.208.208 0 .04-.008.084-.02.132a1.17 1.17 0 0 1-.064.22l-2.06 6.614c-.052.168-.112.284-.18.336-.068.056-.176.084-.328.084h-.732c-.16 0-.27-.028-.344-.088s-.132-.176-.172-.34l-1.328-5.54-1.32 5.536c-.044.168-.1.284-.172.34-.072.06-.184.088-.344.088h-.732zM20.44 12.75c-.456 0-.912-.052-1.352-.156-.44-.104-.784-.22-1.016-.348-.14-.08-.236-.168-.272-.252a.632.632 0 0 1-.056-.252v-.38c0-.18.068-.268.2-.268.052 0 .104.008.156.024.052.016.13.052.22.088.296.132.624.236.98.308.36.072.71.108 1.07.108.566 0 1.007-.1 1.316-.3.307-.2.467-.488.467-.856a.771.771 0 0 0-.214-.552c-.143-.148-.412-.28-.804-.404l-1.16-.356c-.584-.184-1.016-.452-1.284-.804a1.896 1.896 0 0 1-.4-1.176c0-.34.074-.64.22-.896.148-.256.348-.48.596-.66.248-.18.528-.316.848-.408a3.5 3.5 0 0 1 1.02-.14c.18 0 .364.012.542.032.184.02.35.052.516.088.16.036.312.08.454.128.144.048.258.096.34.148.116.068.2.14.248.216.048.072.072.16.072.268v.352c0 .18-.068.272-.2.272-.072 0-.184-.04-.332-.116-.447-.2-.948-.3-1.504-.3-.51 0-.916.084-1.207.252-.292.168-.44.42-.44.764 0 .22.078.408.236.564.156.156.45.312.876.452l1.136.355c.576.18.992.432 1.244.764.252.332.376.712.376 1.136 0 .348-.072.66-.212.936-.144.276-.34.516-.592.716-.252.204-.552.36-.896.468a3.785 3.785 0 0 1-1.124.16z"/>
              </svg>
            </div>
            <span style={{ color:AWS.white, fontSize:16, fontWeight:700, letterSpacing:".01em" }}>
              DevOps Agent
            </span>
          </div>

          {/* Services nav — module links */}
          <div style={{ display:"flex", alignItems:"center", gap:2, flex:1, overflow:"hidden" }}>
            <NavDropdown
              label={`Services ▾`}
              options={Object.entries(MODULES).map(([k,m])=>({ value:k, icon:m.icon, label:m.label }))}
              onSelect={o => switchModule(o.value)}
            />
            {/* breadcrumb shortcut for current module */}
            <span style={{ color:"rgba(255,255,255,.4)", fontSize:13, padding:"0 4px" }}>›</span>
            <span style={{ color:AWS.orange, fontSize:13, fontWeight:600 }}>{modInfo.label}</span>
          </div>

          {/* Right nav items */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            {/* Target dropdown */}
            <NavDropdown
              label={hasSSH ? `🖥 ${activeSSH.name}` : "🖥 No target"}
              options={[
                ...sshOptions,
                { value:"__local__", icon:"💻", label:"Local (no SSH)" },
              ]}
              onSelect={o => setActiveSSHId(o.value!=="__local__" ? o.value : null)}
            />

            {/* AWS account dropdown */}
            <NavDropdown
              label={hasAWS ? `☁ ${activeAWS.name}` : "☁ No account"}
              options={awsOptions}
              onSelect={o => setActiveAWSId(o.value)}
            />

            {/* Region badge */}
            {hasAWS && (
              <div style={{ padding:"4px 10px", border:"1px solid rgba(255,255,255,.2)",
                borderRadius:2, color:"rgba(255,255,255,.85)", fontSize:12, cursor:"default",
                fontFamily:"'JetBrains Mono',monospace" }}>
                {activeAWS.region}
              </div>
            )}

            <div style={{ width:1, height:20, background:"rgba(255,255,255,.15)", margin:"0 6px" }} />

            {/* Settings button */}
            <button onClick={() => setShowSettings(true)}
              style={{ padding:"5px 12px", background:"transparent",
                border:"1px solid rgba(255,255,255,.25)", borderRadius:2,
                color:"rgba(255,255,255,.85)", fontSize:13, cursor:"pointer",
                display:"flex", alignItems:"center", gap:6 }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.1)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              ⚙ Settings
              {!creds.groq?.key && (
                <span style={{ background:AWS.red, color:AWS.white, borderRadius:10,
                  padding:"1px 6px", fontSize:10, fontWeight:700 }}>!</span>
              )}
            </button>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            SECONDARY NAV — AWS console breadcrumb + actions bar
        ══════════════════════════════════════════════════════════════ */}
        <div style={{ background:AWS.surface, borderBottom:`1px solid ${AWS.border}`,
          padding:"8px 20px", display:"flex", alignItems:"center", gap:12,
          flexShrink:0 }}>
          {/* Breadcrumb */}
          <div style={{ display:"flex", alignItems:"center", gap:6, flex:1,
            fontSize:13, color:AWS.textMuted }}>
            <span>DevOps Agent</span>
            <span style={{ color:AWS.borderDark }}>›</span>
            <span style={{ color:AWS.blue, cursor:"pointer" }}
              className="btn-link">{modInfo.label}</span>
            <span style={{ color:AWS.borderDark }}>›</span>
            <span style={{ color:AWS.text, fontWeight:600 }}>Console</span>
          </div>

          {/* Action buttons */}
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {sessionId && (
              <span style={{ fontSize:11, color:AWS.textMuted,
                fontFamily:"'JetBrains Mono',monospace",
                padding:"3px 8px", border:`1px solid ${AWS.border}`,
                borderRadius:2, background:AWS.bg }}>
                Session {sessionId.slice(0,8)}
              </span>
            )}
            <button onClick={() => setShowHistory(true)}
              style={{ padding:"5px 12px", background:AWS.surface, color:AWS.text,
                border:`1px solid ${AWS.borderDark}`, borderRadius:2,
                fontSize:13, cursor:"pointer", display:"flex",
                alignItems:"center", gap:5 }}
              onMouseEnter={e=>e.currentTarget.style.background=AWS.bg}
              onMouseLeave={e=>e.currentTarget.style.background=AWS.surface}>
              History
              {cmdHistory.length > 0 && (
                <span style={{ background:AWS.blue, color:AWS.white, borderRadius:10,
                  padding:"1px 6px", fontSize:10, fontWeight:700 }}>
                  {cmdHistory.length}
                </span>
              )}
            </button>
            <button onClick={newSession}
              style={{ padding:"5px 12px", background:AWS.surface, color:AWS.text,
                border:`1px solid ${AWS.borderDark}`, borderRadius:2,
                fontSize:13, cursor:"pointer" }}
              onMouseEnter={e=>e.currentTarget.style.background=AWS.bg}
              onMouseLeave={e=>e.currentTarget.style.background=AWS.surface}>
              New session
            </button>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════════
            MAIN CONTENT  — sidebar + chat
        ══════════════════════════════════════════════════════════════ */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* ── Left nav panel (AWS left navigation) ───────────────────────── */}
          <div style={{ width:200, minWidth:200, background:AWS.surface,
            borderRight:`1px solid ${AWS.border}`, display:"flex",
            flexDirection:"column", overflow:"hidden", flexShrink:0 }}>

            {/* Nav section header */}
            <div style={{ padding:"12px 16px 6px",
              fontSize:11, fontWeight:700, color:AWS.textMuted,
              textTransform:"uppercase", letterSpacing:".08em" }}>
              Services
            </div>

            {/* Module nav items */}
            {Object.entries(MODULES).map(([key, m]) => (
              <div key={key} className={`nav-item ${mod===key?"active":""}`}
                onClick={() => switchModule(key)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 16px",
                  cursor:"pointer", fontSize:13, fontWeight: mod===key ? 600 : 400,
                  color: mod===key ? AWS.orange : AWS.text,
                  background: mod===key ? "#f0f3f4" : "transparent",
                  borderLeft: mod===key ? `3px solid ${AWS.orange}` : "3px solid transparent",
                  transition:"all .12s" }}>
                <span style={{ fontSize:15 }}>{m.icon}</span>
                <span>{m.label}</span>
              </div>
            ))}

            <div style={{ height:1, background:AWS.border, margin:"8px 0" }} />

            {/* Status section */}
            <div style={{ padding:"8px 16px 6px",
              fontSize:11, fontWeight:700, color:AWS.textMuted,
              textTransform:"uppercase", letterSpacing:".08em" }}>
              Status
            </div>
            <div style={{ padding:"4px 16px 12px", display:"flex",
              flexDirection:"column", gap:6 }}>
              {[
                { label:"LLM",    ok:!!creds.groq?.key, text: creds.groq?.key ? "Connected" : "Not configured" },
                { label:"Target", ok:hasSSH,            text: hasSSH ? activeSSH.name : "Local only" },
                { label:"AWS",    ok:hasAWS,            text: hasAWS ? activeAWS.region : "Not configured" },
              ].map((s,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                    background: s.ok ? AWS.green : AWS.borderDark }} />
                  <span style={{ color:AWS.textMuted }}>{s.label}:</span>
                  <span style={{ color:AWS.text, overflow:"hidden",
                    textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.text}</span>
                </div>
              ))}
            </div>

            {/* Quick suggestions */}
            <div style={{ height:1, background:AWS.border, margin:"0 0 8px" }} />
            <div style={{ padding:"4px 16px 6px",
              fontSize:11, fontWeight:700, color:AWS.textMuted,
              textTransform:"uppercase", letterSpacing:".08em" }}>
              Quick actions
            </div>
            <div style={{ padding:"0 10px 10px", display:"flex", flexDirection:"column", gap:4 }}>
              {modInfo.quickCmds.map(cmd => (
                <div key={cmd}
                  onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
                  style={{ fontSize:12, color:AWS.textMuted, cursor:"pointer",
                    padding:"4px 6px", borderRadius:2, whiteSpace:"nowrap",
                    overflow:"hidden", textOverflow:"ellipsis", transition:"all .12s" }}
                  onMouseEnter={e=>{ e.currentTarget.style.background=AWS.bg; e.currentTarget.style.color=AWS.blue; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; e.currentTarget.style.color=AWS.textMuted; }}>
                  › {cmd}
                </div>
              ))}
            </div>
          </div>

          {/* ── Content area ─────────────────────────────────────────────────── */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

            {/* Page header card */}
            <div style={{ background:AWS.surface, borderBottom:`1px solid ${AWS.border}`,
              padding:"14px 20px", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"flex-start",
                justifyContent:"space-between", gap:12 }}>
                <div>
                  <h1 style={{ fontSize:20, fontWeight:700, color:AWS.text, marginBottom:3 }}>
                    {modInfo.icon} {modInfo.label}
                  </h1>
                  <p style={{ fontSize:13, color:AWS.textMuted }}>{modInfo.service}</p>
                </div>
                {/* Status pill row */}
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <StatusPill
                    ok={!!creds.groq?.key}
                    okLabel={`LLM: ${(creds.groq?.model||"").split("-").slice(0,3).join("-")}`}
                    failLabel="LLM: Not configured"
                  />
                  <StatusPill
                    ok={hasSSH}
                    okLabel={`SSH: ${activeSSH?.host||""}`}
                    failLabel="SSH: Local"
                    warnColor
                  />
                  <StatusPill
                    ok={hasAWS}
                    okLabel={`AWS: ${activeAWS?.region||""}`}
                    failLabel="AWS: Not configured"
                    warnColor
                  />
                </div>
              </div>

              {/* No API key warning */}
              {!creds.groq?.key && (
                <div style={{ marginTop:10 }}>
                  <Alert type="warning" title="API key required">
                    Open <button onClick={()=>setShowSettings(true)}
                      style={{ background:"none", border:"none", color:AWS.blue,
                        cursor:"pointer", fontSize:13, padding:0, textDecoration:"underline" }}>
                      Settings
                    </button> and add your Groq API key to start using the agent.
                  </Alert>
                </div>
              )}
            </div>

            {/* ── Chat messages ─────────────────────────────────────────── */}
            <div style={{ flex:1, overflowY:"auto", padding:"16px 20px",
              display:"flex", flexDirection:"column", gap:16, background:AWS.bg }}>
              {messages.map((msg, i) => (
                <ChatMessage key={i}
                  role={msg.role}
                  content={msg.content}
                  time={msg.time}
                  type={msg.type}
                  command={msg.command}
                  onRunCommand={cmd=>{ setInput(cmd); inputRef.current?.focus(); }}
                  onConfirm={msg.type==="confirm"&&!msg.confirmed ? ()=>handleConfirm("YES",i) : null}
                  onCancel={msg.type==="confirm"&&!msg.confirmed  ? ()=>handleConfirm("NO",i)  : null}
                />
              ))}
              {busy && <Thinking />}
              <div ref={chatEndRef} />
            </div>

            {/* ── Input area (AWS-style action bar) ────────────────────── */}
            <div style={{ background:AWS.surface, borderTop:`1px solid ${AWS.border}`,
              padding:"12px 20px", flexShrink:0 }}>
              {/* Suggestion pills */}
              <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                {modInfo.quickCmds.map(cmd => (
                  <button key={cmd} className="pill-btn"
                    onClick={() => { setInput(cmd); inputRef.current?.focus(); }}
                    style={{ padding:"3px 10px", fontSize:12, borderRadius:12,
                      border:`1px solid ${AWS.border}`, background:AWS.bg,
                      color:AWS.textMuted, cursor:"pointer", transition:"all .15s",
                      whiteSpace:"nowrap" }}>
                    {cmd}
                  </button>
                ))}
              </div>

              {/* Input row */}
              <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                {/* Target indicator */}
                <div style={{ padding:"7px 12px", borderRadius:2, fontSize:12,
                  fontFamily:"'JetBrains Mono',monospace", flexShrink:0,
                  background: hasSSH ? AWS.greenBg : AWS.bg,
                  border:`1px solid ${hasSSH ? AWS.greenBorder : AWS.border}`,
                  color: hasSSH ? AWS.green : AWS.textMuted }}>
                  {hasSSH ? `🖥 ${activeSSH.host}` : "💻 local"}
                </div>

                <textarea ref={inputRef}
                  value={input}
                  onChange={e=>setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={modInfo.placeholder}
                  disabled={busy}
                  rows={2}
                  className="aws-input"
                  style={{ ...awsInputBase, flex:1, resize:"none", lineHeight:1.5,
                    opacity: busy ? .6 : 1,
                    fontFamily:"'Noto Sans', sans-serif",
                    padding:"8px 12px" }}
                />

                <button className="btn-primary" onClick={()=>sendMessage()} disabled={busy}
                  style={{ padding:"0 20px", height:58, background:AWS.orange, color:AWS.white,
                    border:"none", borderRadius:2, fontSize:14, fontWeight:700,
                    cursor:"pointer", transition:"all .15s", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  {busy ? (
                    <span style={{ width:16, height:16, border:"2px solid rgba(255,255,255,.35)",
                      borderTop:"2px solid white", borderRadius:"50%",
                      animation:"spin .7s linear infinite", display:"inline-block" }} />
                  ) : "Send"}
                </button>
              </div>

              <div style={{ marginTop:6, fontSize:11, color:AWS.textLight }}>
                Press Enter to send · Shift+Enter for new line · ↑/↓ for history
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSettings && <SettingsModal creds={creds} onSave={saveCreds} onClose={()=>setShowSettings(false)} />}
      {showHistory  && <HistoryDrawer history={cmdHistory} onSelect={v=>setInput(v)} onClose={()=>setShowHistory(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status pill  (used in page header)
// ─────────────────────────────────────────────────────────────────────────────
function StatusPill({ ok, okLabel, failLabel, warnColor }) {
  const color  = ok ? AWS.green  : warnColor ? AWS.textMuted   : AWS.red;
  const bg     = ok ? AWS.greenBg: warnColor ? AWS.bg          : AWS.redBg;
  const border = ok ? AWS.greenBorder: warnColor ? AWS.border  : AWS.redBorder;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px",
      borderRadius:12, fontSize:12, fontWeight:600,
      background:bg, border:`1px solid ${border}`, color }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:color, flexShrink:0 }}/>
      {ok ? okLabel : failLabel}
    </div>
  );
}
