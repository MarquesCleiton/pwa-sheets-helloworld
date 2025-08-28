import{G as L}from"./GoogleAuthManager-YBajxLns.js";import{S}from"./SheetsClient-BqbA6fvN.js";import{l as $}from"./loadNavbar-6w5EyZrw.js";import"./navigation-Cl-AB2MO.js";const d=t=>document.querySelector(t),l=d("#alert"),v=d("#q"),m=d("#tbody"),N=d("#btnAtualizar"),j=d("#btnSair"),f="Cadastro";function h(t,e="warning"){l&&(l.className=`alert alert-${e}`,l.textContent=t,l.classList.remove("d-none"))}function C(){l?.classList.add("d-none")}const w=new S;let c=[],b=[];function A(t){return String(t??"").trim()==="-"}function O(t){const e=Object.values(t);return e.length>0&&e.every(r=>A(r))}function s(t,...e){for(const r of e)if(Object.prototype.hasOwnProperty.call(t,r))return String(t[r]??"");return""}function D(t){if(!m)return;if(!t.length){m.innerHTML='<tr><td colspan="5" class="text-center text-muted py-4">Nenhum registro encontrado.</td></tr>';return}const e=t.map(r=>{const n=r.object,o=s(n,"Nome","nome"),a=s(n,"Email","email","E-mail","e-mail"),i=s(n,"Observações","Observacoes","observações","observacoes"),x=s(n,"Imagem","Foto","foto","imagem"),y=(()=>{const g=String(x||"").trim();return g.startsWith("http")?`<img src="${g}" alt="" class="avatar">`:`<span class="avatar-fallback">${(o||"?").split(/\s+/).filter(Boolean).slice(0,2).map(I=>I[0]?.toUpperCase()??"").join("")||"?"}</span>`})(),E=`./editar.html?tab=${encodeURIComponent(f)}&rowIndex=${r.rowIndex}`;return`
      <tr data-row="${r.rowIndex}">
        <td>${y}</td>
        <td class="fw-medium">${o||""}</td>
        <td>${a||""}</td>
        <td>${i||""}</td>
        <td class="text-end">
          <div class="btn-group actions" role="group" aria-label="Ações">
            <a class="btn btn-outline-primary btn-sm" href="${E}" title="Editar">
              <i class="bi bi-pencil-square"></i>
            </a>
            <button class="btn btn-outline-danger btn-sm btn-del" title="Excluir">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `}).join("");m.innerHTML=e,m.querySelectorAll(".btn-del").forEach(r=>{r.addEventListener("click",async n=>{const o=n.currentTarget.closest("tr");if(!o)return;const a=Number(o.getAttribute("data-row")||NaN);if(Number.isInteger(a)&&confirm("Confirmar exclusão?"))try{await w.softDeleteRowByIndex(f,a),c=c.filter(i=>i.rowIndex!==a),u()}catch(i){h(i?.message||"Erro ao excluir.","danger")}})})}function u(){const t=(v?.value||"").toLowerCase().normalize("NFD").replace(new RegExp("\\p{Diacritic}","gu"),"");t?b=c.filter(e=>{const r=e.object,n=s(r,"Nome","nome"),o=s(r,"Email","email","E-mail","e-mail"),a=s(r,"Observações","Observacoes","observações","observacoes");return[n,o,a].join(" ").toLowerCase().normalize("NFD").replace(new RegExp("\\p{Diacritic}","gu"),"").includes(t)}):b=c.slice(),D(b)}async function p(){C();try{c=(await w.getObjectsWithIndex(f)).map(e=>({rowIndex:e.rowIndex,object:e.object})).filter(e=>!O(e.object)),u()}catch(t){console.error("Erro ao carregar:",t?.message||t),h(t?.message||"Erro ao carregar dados.","danger"),c=[],u()}}document.addEventListener("DOMContentLoaded",()=>{$(),p(),v?.addEventListener("input",()=>u()),N?.addEventListener("click",()=>p()),j?.addEventListener("click",()=>{try{L.logout?.(),localStorage.removeItem("user"),localStorage.removeItem("accessToken")}catch{}location.href="/index.html"})});
