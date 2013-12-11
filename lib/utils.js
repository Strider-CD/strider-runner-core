
var _ = require('lodash')
  , shellParse = require('shell-quote').parse

module.exports = 
  { exitError: exitError
  , sum: sum
  , runPlugin: runPlugin
  , processCmd: processCmd
  }

function exitError(command, code) {
  var e = new Error('Command "' + command + ' failed with code: ' + code)
  e.type = 'exitCode'
  e.code = code
  return e
}

function sum(list) {
  return list.reduce(function (a, b) { return a + b }, 0)
}

function runPlugin(phase, plugin, context, done) {
  if (!plugin[phase]) return done()
  if ('function' === typeof plugin[phase]) {
    return plugin[phase](context, done)
  }
  context.cmd(plugin[phase], function (code) {
    var data = {}
    data[phase + 'Cmd'] = code ? 'failed' : 'passed'
    context.data(data, 'extend')
    done(code && exitError(code), true)
  })
}

function processCmd(cmd, options) {
  if (cmd.cmd) {
    _.extend(options, cmd)
    cmd = options.cmd;
    delete options.cmd
  }
  if (typeof(cmd) === 'string') {
    cmd = {
      command: cmd
    }
  }
  if (typeof(cmd.args) === 'undefined') {
    cmd.args = shellParse(cmd.command)
    cmd.command = cmd.args.shift()
  }
  return cmd
}

