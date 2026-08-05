// В Docker API живёт в отдельном контейнере, поэтому цель задаётся через API_PROXY_TARGET.
const target = process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000';

export default {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
  },
  '/ws': {
    target,
    secure: false,
    ws: true,
  },
};
