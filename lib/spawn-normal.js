'use strict';

var spawn = require('child_process').spawn;

module.exports = function (command, args, options, done) {
  try {
    done(null, spawn(command, args, options))
  } catch (e) {
    done(127)
  }
};
