async function request(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const getHealth = () => request('/api/health');
export const getCorpus = () => request('/api/corpus');
export const getStats = () => request('/api/stats');
export const search = (q, { limit = 8, legislation, status, collection } = {}) => {
  const p = new URLSearchParams({ q, limit: String(limit) });
  if (legislation) p.set('legislation', legislation);
  if (status) p.set('status', status);
  if (collection) p.set('collection', collection);
  return request(`/api/search?${p}`);
};
export const ask = (question, { legislation } = {}) =>
  request('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, ...(legislation ? { legislation } : {}) }),
  });
export const getSection = (act, section) =>
  request(`/api/sections/${encodeURIComponent(act)}/${encodeURIComponent(section)}`);
export const getRelations = () => request('/api/relations');
export const getProvisions = ({ act, collection, verification, q, page = 1, limit = 25 } = {}) => {
  const p = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (act) p.set('act', act);
  if (collection) p.set('collection', collection);
  if (verification) p.set('verification', verification);
  if (q) p.set('q', q);
  return request(`/api/provisions?${p}`);
};
