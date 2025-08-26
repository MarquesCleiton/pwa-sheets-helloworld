export function navigateTo(page: string) {
  window.location.href = `${import.meta.env.BASE_URL}${page}`;
}

export function baseurl(page: string): string {
  return `${import.meta.env.BASE_URL}${page}`;
}
