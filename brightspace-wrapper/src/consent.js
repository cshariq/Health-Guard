const origin = new URLSearchParams(location.search).get('origin') || '';
document.getElementById('origin').textContent = origin;
document.getElementById('deny').onclick = () => window.close();
document.getElementById('allow').onclick = async () => {
  const { approved = [] } = await chrome.storage.local.get('approved');
  if (origin && !approved.includes(origin)) approved.push(origin);
  await chrome.storage.local.set({ approved });
  window.close();
};
