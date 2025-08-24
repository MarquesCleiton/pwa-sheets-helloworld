export function navigateTo(page: string) {
  window.location.href = `${import.meta.env.BASE_URL}${page}`;
}
