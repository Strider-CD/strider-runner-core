
var pty = require('pty.js')
  , ansiclean = require('./ansiclean')

// pty.spawn(cmd, [options], next)
// this is a wrapper around pty.js's spawn, which makes it act a little bit
// more like the normal spawn, in that it gives you an exit code.
//
// Arguments:
//   cmd: string. Will be executed by bash
//   options = the options you'd pass to pty.js
//   next(exitCode)
module.exports = {
  spawn: function (cmd, options, next) {
    if (arguments.length === 2) {
      next = options
      options = {}
    }
    var args = ['/bin/sh', '-c', cmd]
    // Wrap in /usr/bin/env so this works on non-Linux platforms like OS X.
    // Use /bin/sh to get POSIX compatibility in case `bash` isn't present.
    if (typeof options.env === 'object' && Object.keys(options.env).length > 0) {
      var envStr = ""
      Object.keys(options.env).forEach(function(k) {
        envStr += k + "=" + options.env[k] + " "
      })
      args.unshift(envStr.trim())
    }
    var term = pty.spawn('/usr/bin/env', args, options)
      , out = ''
    term.on('data', function (data) {
      out += data;
    });
    term.on('close', function () {
      var exitCode = term.status
      term.destroy()
      return next(exitCode, out)
    });
    term.write(cmd)
    return term
  }
}
