
var ansiparse = require('ansiparse');

module.exports = function (text) {
  return ansiparse(text).map(function (chunk) {
    return chunk.text || '';
  }).join('');
};
