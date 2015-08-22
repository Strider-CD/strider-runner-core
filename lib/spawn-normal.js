
var spawn = require('child_process').spawn
var _ = require('lodash')

module.exports = function (command, args, options, done) {
  // Prevent https://github.com/joyent/node/issues/9158
  options = _.extend({}, options)

  // Trap any other synchronous errors
  try {
    done(null, spawn(command, args, options))
  } catch (err) {
    done(err)
  }
}
