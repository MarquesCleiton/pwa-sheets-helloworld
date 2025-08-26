import { baseurl } from "../utils/navigation";

export async function loadNavbar() {
  console.log("Carregando Navbar");

  const navbarHtml = await fetch(baseurl("src/presentation/componentes/navbar.html")).then(res => res.text());
  const container = document.createElement("div");
  container.innerHTML = navbarHtml;

  const nav = container.querySelector("nav");
  if (!nav) return;

  const links = nav.querySelectorAll(".nav-link");
  const currentPage = window.location.pathname;

  links.forEach(link => {
    const href = link.getAttribute("href");
    if (!href) return;

    // Marcar o ativo
    if (currentPage.includes(href)) {
      link.classList.add("nav-active");

      // Bloqueia o clique para evitar reload da página atual
      link.addEventListener("click", (event) => {
        event.preventDefault();
      });
    }
  });

  document.body.appendChild(nav);
  document.body.style.paddingBottom = "70px";
}
