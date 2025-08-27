import"./GoogleAuthManager-YBajxLns.js";import{S as h}from"./SheetsClient-BqbA6fvN.js";import{l as y}from"./loadNavbar-6w5EyZrw.js";import"./navigation-Cl-AB2MO.js";const x="Cadastro",E=3e4,s=t=>document.querySelector(t),S=new URLSearchParams(window.location.search),f=S.get("tab")||x,l=s("#tbody"),v=s("#q"),L=s("#btnAtualizar"),A=s("#btnSair"),o=s("#alert");function g(t,n="warning"){o&&(o.className=`alert alert-${n}`,o.textContent=t,o.classList.remove("d-none"))}function $(){o?.classList.add("d-none")}function u(t){return String(t??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;")}function C(t){const n=Object.values(t);return n.length>0&&n.every(e=>String(e).trim()==="-")}const p=new h;let m=[],c=!1;function N(t){if(l){if(!t.length){l.innerHTML=`
      <tr><td colspan="4" class="text-center text-muted py-4">Nenhum registro encontrado.</td></tr>
    `;return}l.innerHTML=t.map(({rowIndex:n,object:e})=>{const r=e.Nome??"",a=e.Email??"",d=e.Observações??e.Observacoes??"",w=`./editar.html?tab=${encodeURIComponent(f)}&rowIndex=${n}`;return`
        <tr data-row-index="${n}">
          <td>${u(r)}</td>
          <td>${u(a)}</td>
          <td class="text-truncate" style="max-width: 420px;">${u(d)}</td>
          <td class="text-end">
            <div class="d-inline-flex gap-1">
              <a class="btn btn-sm btn-outline-primary" href="${w}" title="Editar">
                <i class="bi bi-pencil"></i>
              </a>
              <button
                class="btn btn-sm btn-outline-danger"
                data-action="delete"
                data-row-index="${n}"
                title="Excluir"
              >
                <i class="bi bi-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `}).join("")}}function b(){const t=(v?.value||"").trim().toLowerCase(),n=m.filter(e=>!C(e.object)).filter(({object:e})=>{if(!t)return!0;const r=String(e.Nome??"").toLowerCase(),a=String(e.Email??"").toLowerCase(),d=String(e.Observações??e.Observacoes??"").toLowerCase();return r.includes(t)||a.includes(t)||d.includes(t)});N(n)}async function i(){$();try{m=(await p.getObjectsWithIndex(f)).map(n=>({rowIndex:n.rowIndex,object:n.object})),b()}catch(t){const n=t;console.error("Erro ao carregar:",n?.message||t),g(n?.message||"Erro ao carregar dados.","danger"),m=[],b()}}async function O(t){if(!(!Number.isInteger(t)||t<1||!window.confirm(`Confirmar exclusão (soft delete) da linha ${t}?`)))try{await p.softDeleteRowByIndex(f,t),await i()}catch(e){const r=e;console.error("Erro ao excluir:",r?.message||e),g(r?.message||"Erro ao excluir.","danger")}}l?.addEventListener("click",t=>{const e=t.target.closest('button[data-action="delete"]');if(!e)return;const r=e.getAttribute("data-row-index"),a=r?Number(r):NaN;O(a)});v?.addEventListener("input",()=>b());L?.addEventListener("click",()=>{i()});A?.addEventListener("click",()=>{try{localStorage.removeItem("user"),localStorage.removeItem("accessToken")}catch{}window.location.href="../../index.html"});function k(){i(),window.setInterval(async()=>{if(!(document.visibilityState!=="visible"||c)){c=!0;try{await i()}finally{c=!1}}},E),document.addEventListener("visibilitychange",()=>{document.visibilityState==="visible"&&!c&&i()})}document.addEventListener("DOMContentLoaded",()=>{y(),k()});
