export function navigateTo(page: string) {
  if (page.startsWith("http")) {
    window.location.href = page; // URL absoluta
  } else if (page.startsWith("/")) {
    window.location.href = page; // caminho absoluto dentro do host
  } else {
    window.location.href = `${import.meta.env.BASE_URL}${page}`;
  }
}


export function baseurl(page: string): string {
  return `${import.meta.env.BASE_URL}${page}`;
}
