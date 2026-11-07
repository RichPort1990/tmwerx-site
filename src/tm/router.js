// A small path router for the JSON APIs: add('GET', '/jobs/:id', fn) then run(method, path) -> fn(params) or null.
export function makeRouter() {
  const routes = [];
  return {
    add(method, pattern, fn) {
      const keys = [];
      const re = new RegExp(
        '^' +
          pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => {
            keys.push(k);
            return '([^/]+)';
          }) +
          '$'
      );
      routes.push({ method, re, keys, fn });
    },
    find(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(path);
        if (!m) continue;
        const p = {};
        r.keys.forEach((k, i) => {
          try {
            p[k] = decodeURIComponent(m[i + 1]);
          } catch (e) {
            p[k] = m[i + 1];
          }
        });
        return { fn: r.fn, params: p };
      }
      return null;
    },
  };
}
