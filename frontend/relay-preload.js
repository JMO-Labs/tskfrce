// Marks every request relayed / not relayed from its raw wire headers before Next sees it.
// Production: `node -r ./relay-preload.js server.js` (Dockerfile runtime, next start).
// Dev: required by our custom server.js.
const http = require('http')
const { markRelayed } = require('./clientIp')

const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === 'request') markRelayed(req)
  return emit.call(this, event, req, ...rest)
}
